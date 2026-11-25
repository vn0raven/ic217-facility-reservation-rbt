export interface ScheduleKey {
  /** Finite timestamp in epoch milliseconds. */
  readonly start: number;
  readonly id: string;
}

export function compareScheduleKeys(a: ScheduleKey, b: ScheduleKey): number {
  if (!Number.isFinite(a.start) || !Number.isFinite(b.start)) {
    throw new RangeError("ScheduleKey.start must be a finite timestamp.");
  }
  if (a.start !== b.start) return a.start < b.start ? -1 : 1;
  return a.id === b.id ? 0 : a.id < b.id ? -1 : 1;
}

export interface TreeEntry<K, V> {
  readonly key: K;
  readonly value: V;
}

export type NodeColor = "red" | "black";

export interface TreeNodeSnapshot<K, V> {
  readonly key: K;
  readonly value: V;
  readonly color: NodeColor;
  readonly parentKey: K | null;
  readonly leftKey: K | null;
  readonly rightKey: K | null;
  readonly depth: number;
  readonly blackDepth: number;
}

export interface TreeSnapshot<K, V> {
  readonly size: number;
  readonly height: number;
  readonly blackHeight: number;
  readonly invariantsValid: boolean;
  readonly rootKey: K | null;
  readonly nodes: ReadonlyArray<TreeNodeSnapshot<K, V>>;
}

function defaultDescribeKey<K>(key: K): string {
  if (typeof key === "object" && key !== null && "id" in key) {
    const id = (key as { id: unknown }).id;
    if (typeof id === "string" && id.length > 0) return id;
  }
  return String(key);
}

class TreeNode<K, V> {
  left: TreeNode<K, V> = this;
  right: TreeNode<K, V> = this;
  parent: TreeNode<K, V> = this;
  color: NodeColor = "black";
  readonly entry: TreeEntry<K, V> | undefined;

  constructor(entry?: TreeEntry<K, V>) {
    this.entry = entry;
  }

  get key(): K {
    return this.entry!.key;
  }
}

export class RedBlackTree<K, V> {
  // All missing children share one black sentinel.
  private readonly nil = new TreeNode<K, V>();
  private root = this.nil;
  private count = 0;
  private lastSteps: ReadonlyArray<string> = Object.freeze([]);
  private readonly compare: (a: K, b: K) => number;
  private readonly describeKey: (key: K) => string;

  /** The comparator must define a total order. Stored keys must stay immutable. */
  constructor(
    compare: (a: K, b: K) => number,
    describeKey: (key: K) => string = defaultDescribeKey,
  ) {
    this.compare = compare;
    this.describeKey = describeKey;
  }

  get size(): number {
    return this.count;
  }

  /** Step-by-step balancing trace recorded during the most recent insert or delete. */
  getLastOperationSteps(): ReadonlyArray<string> {
    return this.lastSteps;
  }

  /** Returns false and keeps the existing value when the key is present. */
  insert(key: K, value: V): boolean {
    let parent = this.nil;
    let current = this.root;
    let order = 0;
    while (current !== this.nil) {
      parent = current;
      order = this.compare(key, current.key);
      if (order === 0) {
        this.lastSteps = Object.freeze([
          `Duplicate key ${this.describeKey(key)} ignored; existing entry preserved`,
        ]);
        return false;
      }
      current = order < 0 ? current.left : current.right;
    }

    if (typeof key === "object" && key !== null) Object.freeze(key);
    const node = new TreeNode(Object.freeze({ key, value }));
    node.parent = parent;
    node.left = this.nil;
    node.right = this.nil;
    node.color = "red";

    const steps: string[] = [];
    if (parent === this.nil) {
      this.root = node;
      steps.push(`Inserted ${this.describeKey(key)} as initial root`);
    } else if (order < 0) {
      parent.left = node;
      steps.push(
        `Inserted red node ${this.describeKey(key)} as left child of ${this.describeKey(parent.key)}`,
      );
    } else {
      parent.right = node;
      steps.push(
        `Inserted red node ${this.describeKey(key)} as right child of ${this.describeKey(parent.key)}`,
      );
    }

    this.count++;
    this.fixInsertion(node, steps);
    this.lastSteps = Object.freeze(steps);
    return true;
  }

  search(key: K): TreeEntry<K, V> | undefined {
    return this.find(key).entry;
  }

  delete(key: K): boolean {
    const target = this.find(key);
    if (target === this.nil) {
      this.lastSteps = Object.freeze([
        `Key ${this.describeKey(key)} not found; tree unchanged`,
      ]);
      return false;
    }

    const steps: string[] = [];
    let removedColor = target.color;
    let replacement: TreeNode<K, V>;
    if (target.left === this.nil) {
      replacement = target.right;
      this.transplant(target, replacement);
      steps.push(`Removed ${removedColor} node ${this.describeKey(target.key)} (no left child)`);
    } else if (target.right === this.nil) {
      replacement = target.left;
      this.transplant(target, replacement);
      steps.push(`Removed ${removedColor} node ${this.describeKey(target.key)} (no right child)`);
    } else {
      let successor = target.right;
      while (successor.left !== this.nil) successor = successor.left;
      removedColor = successor.color;
      replacement = successor.right;
      if (successor.parent === target) {
        replacement.parent = successor;
      } else {
        this.transplant(successor, replacement);
        successor.right = target.right;
        successor.right.parent = successor;
      }
      this.transplant(target, successor);
      successor.left = target.left;
      successor.left.parent = successor;
      successor.color = target.color;
      steps.push(
        `Replaced ${this.describeKey(target.key)} with in-order successor ${this.describeKey(successor.key)}`,
      );
    }

    this.count--;
    if (removedColor === "black") {
      this.fixDeletion(replacement, steps);
    }
    this.nil.parent = this.nil;
    this.lastSteps = Object.freeze(steps);
    return true;
  }

  *inOrder(): IterableIterator<TreeEntry<K, V>> {
    const stack: TreeNode<K, V>[] = [];
    let current = this.root;
    while (current !== this.nil || stack.length > 0) {
      while (current !== this.nil) {
        stack.push(current);
        current = current.left;
      }
      current = stack.pop()!;
      yield current.entry!;
      current = current.right;
    }
  }

  /** Yields entries with keys greater than or equal to lower in ascending order. */
  *rangeFrom(lower: K): IterableIterator<TreeEntry<K, V>> {
    const stack: TreeNode<K, V>[] = [];
    let current = this.root;
    while (current !== this.nil) {
      if (this.compare(current.key, lower) >= 0) {
        stack.push(current);
        current = current.left;
      } else {
        current = current.right;
      }
    }
    while (stack.length > 0) {
      const visit = stack.pop()!;
      yield visit.entry!;
      let next = visit.right;
      while (next !== this.nil) {
        stack.push(next);
        next = next.left;
      }
    }
  }

  /** Greatest key strictly below the probe, even when the probe is absent. */
  predecessor(key: K): TreeEntry<K, V> | undefined {
    return this.neighbor(key, "left", false);
  }

  /** Smallest key strictly above the probe, even when the probe is absent. */
  successor(key: K): TreeEntry<K, V> | undefined {
    return this.neighbor(key, "right", false);
  }

  /** Smallest key greater than or equal to the probe. */
  lowerBound(key: K): TreeEntry<K, V> | undefined {
    return this.neighbor(key, "right", true);
  }

  /** Exports an immutable level-order snapshot of every real node and its links. */
  exportSnapshot(): TreeSnapshot<K, V> {
    const invariantsValid = this.verifyInvariants();
    if (this.root === this.nil) {
      return Object.freeze({
        size: 0,
        height: 0,
        blackHeight: 0,
        invariantsValid,
        rootKey: null,
        nodes: Object.freeze([]),
      });
    }

    let blackHeight = 0;
    let spine = this.root;
    while (spine !== this.nil) {
      if (spine.color === "black") blackHeight++;
      spine = spine.left;
    }

    const nodes: TreeNodeSnapshot<K, V>[] = [];
    const queue: Array<{ node: TreeNode<K, V>; depth: number; blackDepth: number }> = [
      {
        node: this.root,
        depth: 0,
        blackDepth: this.root.color === "black" ? 1 : 0,
      },
    ];
    let maxDepth = 0;

    for (let index = 0; index < queue.length; index++) {
      const { node, depth, blackDepth } = queue[index];
      if (depth > maxDepth) maxDepth = depth;

      nodes.push(
        Object.freeze({
          key: node.key,
          value: node.entry!.value,
          color: node.color,
          parentKey: node.parent === this.nil ? null : node.parent.key,
          leftKey: node.left === this.nil ? null : node.left.key,
          rightKey: node.right === this.nil ? null : node.right.key,
          depth,
          blackDepth,
        }),
      );

      if (node.left !== this.nil) {
        queue.push({
          node: node.left,
          depth: depth + 1,
          blackDepth: blackDepth + (node.left.color === "black" ? 1 : 0),
        });
      }
      if (node.right !== this.nil) {
        queue.push({
          node: node.right,
          depth: depth + 1,
          blackDepth: blackDepth + (node.right.color === "black" ? 1 : 0),
        });
      }
    }

    return Object.freeze({
      size: this.count,
      height: maxDepth + 1,
      blackHeight,
      invariantsValid,
      rootKey: this.root.key,
      nodes: Object.freeze(nodes),
    });
  }

  verifyInvariants(): boolean {
    if (this.nil.color !== "black" || this.nil.left !== this.nil ||
        this.nil.right !== this.nil || this.nil.parent !== this.nil ||
        this.root.color !== "black" || this.root.parent !== this.nil) return false;

    const visited = new Set<TreeNode<K, V>>();
    const blackHeight = (
      node: TreeNode<K, V>,
      parent: TreeNode<K, V>,
      lower: TreeNode<K, V>,
      upper: TreeNode<K, V>,
    ): number => {
      if (node === this.nil) return 1;
      if (visited.has(node) || node.parent !== parent ||
          (lower !== this.nil && this.compare(node.key, lower.key) <= 0) ||
          (upper !== this.nil && this.compare(node.key, upper.key) >= 0) ||
          (node.color === "red" && (node.left.color === "red" || node.right.color === "red"))) {
        return -1;
      }
      visited.add(node);
      const leftHeight = blackHeight(node.left, node, lower, node);
      const rightHeight = blackHeight(node.right, node, node, upper);
      if (leftHeight < 0 || leftHeight !== rightHeight) return -1;
      return leftHeight + (node.color === "black" ? 1 : 0);
    };

    return blackHeight(this.root, this.nil, this.nil, this.nil) > 0 &&
      visited.size === this.count;
  }

  private find(key: K): TreeNode<K, V> {
    let current = this.root;
    while (current !== this.nil) {
      const order = this.compare(key, current.key);
      if (order === 0) return current;
      current = order < 0 ? current.left : current.right;
    }
    return this.nil;
  }

  private neighbor(key: K, side: "left" | "right", inclusive: boolean): TreeEntry<K, V> | undefined {
    let current = this.root;
    let candidate = this.nil;
    while (current !== this.nil) {
      const order = this.compare(current.key, key);
      if (order === 0 && inclusive) return current.entry;
      const qualifies = side === "left" ? order < 0 : order > 0;
      if (qualifies) candidate = current;
      current = qualifies === (side === "left") ? current.right : current.left;
    }
    return candidate.entry;
  }

  private transplant(oldRoot: TreeNode<K, V>, newRoot: TreeNode<K, V>): void {
    if (oldRoot.parent === this.nil) this.root = newRoot;
    else if (oldRoot === oldRoot.parent.left) oldRoot.parent.left = newRoot;
    else oldRoot.parent.right = newRoot;
    newRoot.parent = oldRoot.parent;
  }

  private rotateLeft(node: TreeNode<K, V>): void {
    const pivot = node.right;
    node.right = pivot.left;
    if (node.right !== this.nil) node.right.parent = node;
    this.transplant(node, pivot);
    pivot.left = node;
    node.parent = pivot;
  }

  private rotateRight(node: TreeNode<K, V>): void {
    const pivot = node.left;
    node.left = pivot.right;
    if (node.left !== this.nil) node.left.parent = node;
    this.transplant(node, pivot);
    pivot.right = node;
    node.parent = pivot;
  }

  private fixInsertion(node: TreeNode<K, V>, steps: string[]): void {
    while (node.parent.color === "red") {
      const grandparent = node.parent.parent;
      const parentOnLeft = node.parent === grandparent.left;
      const uncle = parentOnLeft ? grandparent.right : grandparent.left;
      if (uncle.color === "red") {
        node.parent.color = "black";
        uncle.color = "black";
        grandparent.color = "red";
        steps.push(
          `Recolored parent ${this.describeKey(node.parent.key)} and uncle ${this.describeKey(uncle.key)} black; grandparent ${this.describeKey(grandparent.key)} red`,
        );
        node = grandparent;
        continue;
      }

      // Rotate a bent path into a straight path before rotating the grandparent.
      if (parentOnLeft && node === node.parent.right) {
        node = node.parent;
        this.rotateLeft(node);
        steps.push(`Left-rotated around ${this.describeKey(node.key)} to align left-right path`);
      } else if (!parentOnLeft && node === node.parent.left) {
        node = node.parent;
        this.rotateRight(node);
        steps.push(`Right-rotated around ${this.describeKey(node.key)} to align right-left path`);
      }
      node.parent.color = "black";
      grandparent.color = "red";
      if (parentOnLeft) {
        this.rotateRight(grandparent);
        steps.push(
          `Recolored ${this.describeKey(node.parent.key)} black and right-rotated around ${this.describeKey(grandparent.key)}`,
        );
      } else {
        this.rotateLeft(grandparent);
        steps.push(
          `Recolored ${this.describeKey(node.parent.key)} black and left-rotated around ${this.describeKey(grandparent.key)}`,
        );
      }
    }
    if (this.root.color !== "black") {
      this.root.color = "black";
      steps.push(`Colored root ${this.describeKey(this.root.key)} black`);
    }
  }

  private fixDeletion(node: TreeNode<K, V>, steps: string[]): void {
    while (node !== this.root && node.color === "black") {
      const parent = node.parent;
      const onLeft = node === parent.left;
      const near = onLeft ? "left" : "right";
      const far = onLeft ? "right" : "left";
      let sibling = parent[far];

      if (sibling.color === "red") {
        sibling.color = "black";
        parent.color = "red";
        if (onLeft) {
          this.rotateLeft(parent);
          steps.push(
            `Converted red sibling ${this.describeKey(sibling.key)} via left-rotation around ${this.describeKey(parent.key)}`,
          );
        } else {
          this.rotateRight(parent);
          steps.push(
            `Converted red sibling ${this.describeKey(sibling.key)} via right-rotation around ${this.describeKey(parent.key)}`,
          );
        }
        sibling = parent[far];
      }

      if (sibling[near].color === "black" && sibling[far].color === "black") {
        // Move the missing black level up to the parent.
        sibling.color = "red";
        steps.push(`Recolored sibling ${this.describeKey(sibling.key)} red and propagated fixup upward`);
        node = parent;
        continue;
      }

      if (sibling[far].color === "black") {
        sibling[near].color = "black";
        sibling.color = "red";
        if (onLeft) {
          this.rotateRight(sibling);
          steps.push(`Right-rotated around sibling ${this.describeKey(sibling.key)}`);
        } else {
          this.rotateLeft(sibling);
          steps.push(`Left-rotated around sibling ${this.describeKey(sibling.key)}`);
        }
        sibling = parent[far];
      }

      sibling.color = parent.color;
      parent.color = "black";
      sibling[far].color = "black";
      if (onLeft) {
        this.rotateLeft(parent);
        steps.push(
          `Left-rotated around ${this.describeKey(parent.key)} and restored black-height balance`,
        );
      } else {
        this.rotateRight(parent);
        steps.push(
          `Right-rotated around ${this.describeKey(parent.key)} and restored black-height balance`,
        );
      }
      node = this.root;
    }
    if (node.color !== "black") {
      node.color = "black";
      steps.push(`Colored replacement node ${this.describeKey(node.key)} black`);
    }
  }
}
