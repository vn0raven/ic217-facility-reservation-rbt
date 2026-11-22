export interface ScheduleKey {
  /** Finite timestamp in epoch milliseconds. */
  readonly start: number;
  readonly id: string;
}

export function compareScheduleKeys(a: ScheduleKey, b: ScheduleKey): number {
  if (a.start !== b.start) return a.start < b.start ? -1 : 1;
  return a.id === b.id ? 0 : a.id < b.id ? -1 : 1;
}

export interface TreeEntry<K, V> {
  readonly key: K;
  readonly value: V;
}

type Color = "red" | "black";

class TreeNode<K, V> {
  left: TreeNode<K, V> = this;
  right: TreeNode<K, V> = this;
  parent: TreeNode<K, V> = this;
  color: Color = "black";
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
  private readonly compare: (a: K, b: K) => number;

  /** The comparator must define a total order. Stored keys must stay immutable. */
  constructor(compare: (a: K, b: K) => number) {
    this.compare = compare;
  }

  get size(): number {
    return this.count;
  }

  /** Returns false and keeps the existing value when the key is present. */
  insert(key: K, value: V): boolean {
    let parent = this.nil;
    let current = this.root;
    let order = 0;
    while (current !== this.nil) {
      parent = current;
      order = this.compare(key, current.key);
      if (order === 0) return false;
      current = order < 0 ? current.left : current.right;
    }

    const node = new TreeNode(Object.freeze({ key, value }));
    node.parent = parent;
    node.left = this.nil;
    node.right = this.nil;
    node.color = "red";
    if (parent === this.nil) this.root = node;
    else if (order < 0) parent.left = node;
    else parent.right = node;
    this.count++;
    this.fixInsertion(node);
    return true;
  }

  search(key: K): TreeEntry<K, V> | undefined {
    return this.find(key).entry;
  }

  delete(key: K): boolean {
    const target = this.find(key);
    if (target === this.nil) return false;

    let removedColor = target.color;
    let replacement: TreeNode<K, V>;
    if (target.left === this.nil) {
      replacement = target.right;
      this.transplant(target, replacement);
    } else if (target.right === this.nil) {
      replacement = target.left;
      this.transplant(target, replacement);
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
    }

    this.count--;
    if (removedColor === "black") this.fixDeletion(replacement);
    this.nil.parent = this.nil;
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

  private fixInsertion(node: TreeNode<K, V>): void {
    while (node.parent.color === "red") {
      const grandparent = node.parent.parent;
      const parentOnLeft = node.parent === grandparent.left;
      const uncle = parentOnLeft ? grandparent.right : grandparent.left;
      if (uncle.color === "red") {
        node.parent.color = "black";
        uncle.color = "black";
        grandparent.color = "red";
        node = grandparent;
        continue;
      }

      // Rotate a bent path into a straight path before rotating the grandparent.
      if (parentOnLeft && node === node.parent.right) {
        node = node.parent;
        this.rotateLeft(node);
      } else if (!parentOnLeft && node === node.parent.left) {
        node = node.parent;
        this.rotateRight(node);
      }
      node.parent.color = "black";
      grandparent.color = "red";
      if (parentOnLeft) this.rotateRight(grandparent);
      else this.rotateLeft(grandparent);
    }
    this.root.color = "black";
  }

  private fixDeletion(node: TreeNode<K, V>): void {
    while (node !== this.root && node.color === "black") {
      const parent = node.parent;
      const onLeft = node === parent.left;
      const near = onLeft ? "left" : "right";
      const far = onLeft ? "right" : "left";
      let sibling = parent[far];

      if (sibling.color === "red") {
        sibling.color = "black";
        parent.color = "red";
        if (onLeft) this.rotateLeft(parent);
        else this.rotateRight(parent);
        sibling = parent[far];
      }

      if (sibling[near].color === "black" && sibling[far].color === "black") {
        // Move the missing black level up to the parent.
        sibling.color = "red";
        node = parent;
        continue;
      }

      if (sibling[far].color === "black") {
        sibling[near].color = "black";
        sibling.color = "red";
        if (onLeft) this.rotateRight(sibling);
        else this.rotateLeft(sibling);
        sibling = parent[far];
      }

      sibling.color = parent.color;
      parent.color = "black";
      sibling[far].color = "black";
      if (onLeft) this.rotateLeft(parent);
      else this.rotateRight(parent);
      node = this.root;
    }
    node.color = "black";
  }
}
