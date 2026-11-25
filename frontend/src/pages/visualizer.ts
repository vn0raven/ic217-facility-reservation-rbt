import type {
  Facility,
  FacilityTreeLookupView,
  FacilityTreeNodeView,
  FacilityTreeSnapshotView,
} from "../../../shared/types/index.ts";
import { showFieldError } from "../components/form-field.ts";
import { getFacilityTree, lookupFacilityTree } from "../services/api.ts";
import {
  formatManilaRange,
  formatRoleLabel,
  manilaToUtcMs,
  todayManilaDateString,
} from "../services/time.ts";

const SVG_NS = "http://www.w3.org/2000/svg";

const shortNodeTimeFormatter = new Intl.DateTimeFormat("en-PH", {
  timeZone: "Asia/Manila",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export interface VisualizerController {
  refresh(): Promise<void>;
  setFacilities(facilities: Facility[]): void;
  selectFacility(facilityId: number): void;
}

interface PositionedItem {
  kind: "real" | "nil";
  id: string;
  x: number;
  y: number;
  parentX?: number;
  parentY?: number;
  branch?: "L" | "R";
  node?: FacilityTreeNodeView;
}

function createSvgElement<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, String(value));
  }
  return element;
}

function shortKeyLabel(id: string): string {
  const [kind, num] = id.split(":");
  if (kind === "academic") return `ACAD #${num}`;
  if (kind === "reservation") return `RES #${num}`;
  return id;
}

export async function initializeVisualizerPage(
  facilitiesRequest: Promise<Facility[]>,
): Promise<VisualizerController> {
  const facilitySelect = document.querySelector<HTMLSelectElement>("#tree-facility")!;
  const showNilToggle = document.querySelector<HTMLInputElement>("#tree-show-nil")!;
  const refreshButton = document.querySelector<HTMLButtonElement>("#tree-refresh")!;

  const metricSize = document.querySelector<HTMLElement>("#tree-stat-size")!;
  const metricHeight = document.querySelector<HTMLElement>("#tree-stat-height")!;
  const metricBlackHeight = document.querySelector<HTMLElement>("#tree-stat-bh")!;
  const metricRoot = document.querySelector<HTMLElement>("#tree-stat-root")!;
  const metricValid = document.querySelector<HTMLElement>("#tree-stat-valid")!;

  const status = document.querySelector<HTMLParagraphElement>("#tree-status")!;
  const canvasWrap = document.querySelector<HTMLDivElement>("#tree-canvas-wrap")!;
  const inspector = document.querySelector<HTMLDivElement>("#tree-node-inspector")!;

  const probeForm = document.querySelector<HTMLFormElement>("#tree-probe-form")!;
  const probeDate = document.querySelector<HTMLInputElement>("#probe-date")!;
  const probeStart = document.querySelector<HTMLInputElement>("#probe-start")!;
  const probeEnd = document.querySelector<HTMLInputElement>("#probe-end")!;
  const probeClear = document.querySelector<HTMLButtonElement>("#probe-clear")!;
  const probeStatus = document.querySelector<HTMLParagraphElement>("#probe-status")!;

  const operationsList = document.querySelector<HTMLOListElement>("#tree-operations-list")!;

  probeDate.value = todayManilaDateString();

  let latestSnapshot: FacilityTreeSnapshotView | undefined;
  let selectedNodeId: string | null = null;
  let activeLookup: FacilityTreeLookupView | null = null;

  function setFacilities(facilities: Facility[]): void {
    const previous = facilitySelect.value;
    facilitySelect.replaceChildren();
    if (facilities.length === 0) {
      facilitySelect.append(new Option("No facilities listed", ""));
      facilitySelect.disabled = true;
      return;
    }

    for (const item of facilities) {
      const suffix = item.active ? "" : " (Inactive)";
      facilitySelect.append(new Option(`${item.name}${suffix}`, String(item.id)));
    }
    const preferred = facilities.find(item => item.active) ?? facilities[0];
    facilitySelect.value = facilities.some(item => String(item.id) === previous)
      ? previous
      : String(preferred.id);
    facilitySelect.disabled = false;
  }

  try {
    setFacilities(await facilitiesRequest);
  } catch {
    facilitySelect.replaceChildren(new Option("Facilities unavailable", ""));
    facilitySelect.disabled = true;
  }

  function renderMetrics(): void {
    if (!latestSnapshot) {
      metricSize.textContent = "–";
      metricHeight.textContent = "–";
      metricBlackHeight.textContent = "–";
      metricRoot.textContent = "–";
      metricValid.textContent = "–";
      return;
    }
    metricSize.textContent = String(latestSnapshot.size);
    metricHeight.textContent = String(latestSnapshot.height);
    metricBlackHeight.textContent = String(latestSnapshot.blackHeight);
    metricRoot.textContent = latestSnapshot.rootId ?? "NIL (empty)";
    metricValid.textContent = latestSnapshot.invariantsValid ? "Verified" : "Invalid";
  }

  function renderInspector(): void {
    inspector.replaceChildren();
    const heading = document.createElement("h3");
    heading.textContent = "Selected node inspector";
    inspector.append(heading);

    if (!latestSnapshot || latestSnapshot.nodes.length === 0) {
      const empty = document.createElement("p");
      empty.className = "slot-empty";
      empty.textContent = "This facility tree currently has 0 active intervals (root points to the black NIL sentinel).";
      inspector.append(empty);
      return;
    }

    const node = latestSnapshot.nodes.find(n => n.key.id === selectedNodeId)
      ?? latestSnapshot.nodes.find(n => n.key.id === latestSnapshot!.rootId)
      ?? latestSnapshot.nodes[0];
    selectedNodeId = node.key.id;

    const dl = document.createElement("dl");
    const description = node.item.kind === "academic"
      ? `Academic Block — ${node.item.title}`
      : `Approved Reservation — ${node.item.purpose} (${node.item.requesterName}, ${formatRoleLabel(node.item.requesterRole)})`;

    const rows: ReadonlyArray<[string, string]> = [
      ["ScheduleKey", `{ start: ${node.key.start}, id: "${node.key.id}" }`],
      ["Color", node.color.toUpperCase()],
      ["Depth / Black depth", `depth ${node.depth} · blackDepth ${node.blackDepth}`],
      ["Parent", node.parentId ?? "NIL (root)"],
      ["Left / Right", `${node.leftId ?? "NIL"}  /  ${node.rightId ?? "NIL"}`],
      ["Interval", formatManilaRange(node.item.start, node.item.end)],
      ["Record", description],
    ];

    for (const [termText, descText] of rows) {
      const dt = document.createElement("dt");
      dt.textContent = termText;
      const dd = document.createElement("dd");
      dd.textContent = descText;
      dl.append(dt, dd);
    }

    inspector.append(dl);
  }

  function renderOperations(): void {
    operationsList.replaceChildren();
    if (!latestSnapshot || latestSnapshot.operations.length === 0) {
      const li = document.createElement("li");
      li.className = "panel";
      li.textContent = "No tree operations recorded yet.";
      operationsList.append(li);
      return;
    }

    for (const entry of latestSnapshot.operations) {
      const item = document.createElement("li");
      item.className = "panel trace-card";

      const header = document.createElement("div");
      header.className = "card-header";

      const summary = document.createElement("strong");
      summary.textContent = `#${entry.sequence} · ${entry.summary}`;

      const badge = document.createElement("span");
      badge.className = entry.operation === "insert"
        ? "badge badge-confirmed"
        : entry.operation === "delete"
          ? "badge badge-rejected"
          : "badge badge-academic";
      badge.textContent = entry.operation.toUpperCase();

      header.append(summary, badge);
      item.append(header);

      const stepList = document.createElement("ul");
      stepList.className = "trace-steps";
      for (const step of entry.steps) {
        const stepItem = document.createElement("li");
        stepItem.textContent = step;
        stepList.append(stepItem);
      }
      item.append(stepList);
      operationsList.append(item);
    }
  }

  function renderDiagram(): void {
    canvasWrap.replaceChildren();
    if (!latestSnapshot) return;

    if (latestSnapshot.size === 0 || !latestSnapshot.rootId) {
      const svg = createSvgElement("svg", {
        width: 380,
        height: 150,
        viewBox: "0 0 380 150",
        role: "img",
        "aria-label": "Empty Red-Black Tree with black NIL root sentinel",
      });
      const rect = createSvgElement("rect", {
        x: 135,
        y: 45,
        width: 110,
        height: 44,
        rx: 8,
        fill: "#142329",
        stroke: "#0b1418",
        "stroke-width": 2,
      });
      const label = createSvgElement("text", {
        x: 190,
        y: 72,
        "text-anchor": "middle",
        fill: "#ffffff",
        "font-size": 13,
        "font-weight": 700,
      });
      label.textContent = "root = NIL";
      const sub = createSvgElement("text", {
        x: 190,
        y: 116,
        "text-anchor": "middle",
        fill: "#3d5952",
        "font-size": 12,
      });
      sub.textContent = "Black sentinel (0 active schedule intervals)";
      svg.append(rect, label, sub);
      canvasWrap.append(svg);
      return;
    }

    const byId = new Map(latestSnapshot.nodes.map(node => [node.key.id, node]));
    const includeNil = showNilToggle.checked;
    const hStep = includeNil ? 88 : 132;
    const vStep = 104;
    const padX = 80;
    const padY = 54;

    const positioned: PositionedItem[] = [];
    let slotIndex = 0;
    let maxDepth = 0;

    function layoutSubtree(
      nodeId: string | null,
      depth: number,
      parentItem: PositionedItem | undefined,
      branch: "L" | "R" | undefined,
    ): PositionedItem | undefined {
      if (nodeId === null) {
        if (!includeNil || !parentItem) return undefined;
        if (depth > maxDepth) maxDepth = depth;
        const nilItem: PositionedItem = {
          kind: "nil",
          id: `nil:${parentItem.id}:${branch}`,
          x: padX + slotIndex++ * hStep,
          y: padY + depth * vStep,
          parentX: parentItem.x,
          parentY: parentItem.y,
          branch,
        };
        positioned.push(nilItem);
        return nilItem;
      }

      const node = byId.get(nodeId);
      if (!node) return undefined;
      if (depth > maxDepth) maxDepth = depth;

      const current: PositionedItem = {
        kind: "real",
        id: node.key.id,
        x: 0,
        y: padY + depth * vStep,
        branch,
        node,
      };

      const leftChild = layoutSubtree(node.leftId, depth + 1, current, "L");
      current.x = padX + slotIndex++ * hStep;
      const rightChild = layoutSubtree(node.rightId, depth + 1, current, "R");

      if (leftChild) {
        leftChild.parentX = current.x;
        leftChild.parentY = current.y;
      }
      if (rightChild) {
        rightChild.parentX = current.x;
        rightChild.parentY = current.y;
      }

      positioned.push(current);
      return current;
    }

    layoutSubtree(latestSnapshot.rootId, 0, undefined, undefined);

    const width = Math.max(540, padX * 2 + Math.max(0, slotIndex - 1) * hStep);
    const height = padY * 2 + maxDepth * vStep + 26;

    const svg = createSvgElement("svg", {
      width,
      height,
      viewBox: `0 0 ${width} ${height}`,
      role: "img",
      "aria-label": `Red-Black Tree with ${latestSnapshot.size} nodes and black height ${latestSnapshot.blackHeight}`,
    });

    // Draw parent-child edges first
    for (const item of positioned) {
      if (item.parentX === undefined || item.parentY === undefined) continue;
      const line = createSvgElement("line", {
        x1: item.parentX,
        y1: item.parentY,
        x2: item.x,
        y2: item.y,
        stroke: item.kind === "nil" ? "#9fb3ac" : "#4b6860",
        "stroke-width": item.kind === "nil" ? 1.5 : 2.2,
        ...(item.kind === "nil" ? { "stroke-dasharray": "4 3" } : {}),
      });
      svg.append(line);

      if (item.branch) {
        const midX = (item.parentX + item.x) / 2;
        const midY = (item.parentY + item.y) / 2;
        const badgeBg = createSvgElement("circle", {
          cx: midX,
          cy: midY,
          r: 9,
          fill: "#eef4f2",
          stroke: "#88a099",
          "stroke-width": 1,
        });
        const badgeText = createSvgElement("text", {
          x: midX,
          y: midY + 3.5,
          "text-anchor": "middle",
          fill: "#234038",
          "font-size": 10,
          "font-weight": 700,
        });
        badgeText.textContent = item.branch;
        svg.append(badgeBg, badgeText);
      }
    }

    // Draw NIL leaves and real nodes
    for (const item of positioned) {
      if (item.kind === "nil") {
        const nilBox = createSvgElement("rect", {
          x: item.x - 20,
          y: item.y - 12,
          width: 40,
          height: 24,
          rx: 5,
          fill: "#1f2937",
        });
        const nilText = createSvgElement("text", {
          x: item.x,
          y: item.y + 4,
          "text-anchor": "middle",
          fill: "#ffffff",
          "font-size": 10,
          "font-weight": 700,
        });
        nilText.textContent = "NIL";
        svg.append(nilBox, nilText);
        continue;
      }

      const node = item.node!;
      const group = createSvgElement("g", {
        class: "rbt-node",
        tabindex: 0,
        role: "button",
        "aria-label": `${node.color} node ${node.key.id}`,
      });

      const isSelected = node.key.id === selectedNodeId;
      const isConflict = activeLookup?.conflictId === node.key.id;
      const isPred = activeLookup?.predecessorId === node.key.id;
      const isSucc = activeLookup?.successorId === node.key.id;

      if (isConflict || isPred || isSucc || isSelected) {
        const ringColor = isConflict
          ? "#d97706"
          : isPred
            ? "#2563eb"
            : isSucc
              ? "#0d9488"
              : "#bd610f";
        const halo = createSvgElement("rect", {
          x: item.x - 58,
          y: item.y - 33,
          width: 116,
          height: 66,
          rx: 33,
          fill: "none",
          stroke: ringColor,
          "stroke-width": 3.5,
          ...(isConflict ? {} : { "stroke-dasharray": isSelected ? "none" : "6 3" }),
        });
        group.append(halo);
      }

      const pill = createSvgElement("rect", {
        x: item.x - 52,
        y: item.y - 27,
        width: 104,
        height: 54,
        rx: 27,
        fill: node.color === "red" ? "#b91c1c" : "#142329",
        stroke: node.color === "red" ? "#7f1d1d" : "#091114",
        "stroke-width": 2,
      });

      const line1 = createSvgElement("text", {
        x: item.x,
        y: item.y - 6,
        "text-anchor": "middle",
        fill: "#ffffff",
        "font-size": 11.5,
        "font-weight": 700,
      });
      line1.textContent = `${shortKeyLabel(node.key.id)} · ${node.color === "red" ? "R" : "B"}`;

      const line2 = createSvgElement("text", {
        x: item.x,
        y: item.y + 11,
        "text-anchor": "middle",
        fill: "#e6f0ed",
        "font-size": 10,
      });
      line2.textContent = shortNodeTimeFormatter.format(new Date(node.key.start));

      group.append(pill, line1, line2);

      const selectNode = () => {
        selectedNodeId = node.key.id;
        renderInspector();
        renderDiagram();
      };
      group.addEventListener("click", selectNode);
      group.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectNode();
        }
      });

      svg.append(group);
    }

    canvasWrap.append(svg);
  }

  function renderAll(): void {
    renderMetrics();
    renderInspector();
    renderDiagram();
    renderOperations();
  }

  async function refresh(): Promise<void> {
    const facilityId = Number(facilitySelect.value);
    if (!facilityId) {
      latestSnapshot = undefined;
      renderAll();
      return;
    }

    try {
      latestSnapshot = await getFacilityTree(facilityId);
      if (
        selectedNodeId &&
        !latestSnapshot.nodes.some(node => node.key.id === selectedNodeId)
      ) {
        selectedNodeId = latestSnapshot.rootId;
      } else if (!selectedNodeId) {
        selectedNodeId = latestSnapshot.rootId;
      }
      status.textContent = "";
      delete status.dataset.tone;
      renderAll();
    } catch (error) {
      status.dataset.tone = "error";
      status.textContent = error instanceof Error ? error.message : "Unable to load Red-Black Tree snapshot.";
    }
  }

  facilitySelect.addEventListener("change", () => {
    selectedNodeId = null;
    activeLookup = null;
    probeStatus.textContent = "";
    delete probeStatus.dataset.tone;
    void refresh();
  });

  showNilToggle.addEventListener("change", () => {
    renderDiagram();
  });

  refreshButton.addEventListener("click", () => {
    void refresh();
  });

  probeForm.addEventListener("input", () => {
    probeEnd.setCustomValidity("");
    probeStatus.textContent = "";
    delete probeStatus.dataset.tone;
  });

  probeForm.addEventListener("submit", async event => {
    event.preventDefault();
    const facilityId = Number(facilitySelect.value);
    if (!facilityId) return;

    const startMs = manilaToUtcMs(probeDate.value, probeStart.value);
    const endMs = manilaToUtcMs(probeDate.value, probeEnd.value);
    const invalid =
      startMs === undefined || endMs === undefined || endMs <= startMs
        ? "End time must be after start time."
        : "";
    if (!showFieldError(probeEnd, invalid)) return;

    try {
      activeLookup = await lookupFacilityTree(facilityId, startMs!, endMs!);
      const summaryParts = [
        `predecessor: ${activeLookup.predecessorId ?? "NIL"}`,
        `successor: ${activeLookup.successorId ?? "NIL"}`,
        `lowerBound: ${activeLookup.lowerBoundId ?? "NIL"}`,
      ];
      if (activeLookup.available) {
        probeStatus.dataset.tone = "success";
        probeStatus.textContent = `Available (${summaryParts.join(" · ")}). Highlighted neighbors on tree.`;
      } else {
        probeStatus.dataset.tone = "error";
        probeStatus.textContent = `Conflict with ${activeLookup.conflictId} (${summaryParts.join(" · ")}).`;
        selectedNodeId = activeLookup.conflictId;
        renderInspector();
      }
      renderDiagram();
    } catch (error) {
      probeStatus.dataset.tone = "error";
      probeStatus.textContent = error instanceof Error ? error.message : "Probe lookup failed.";
    }
  });

  probeClear.addEventListener("click", () => {
    activeLookup = null;
    probeStatus.textContent = "";
    delete probeStatus.dataset.tone;
    renderDiagram();
  });

  await refresh();

  return {
    refresh,
    setFacilities(facilities: Facility[]) {
      setFacilities(facilities);
      void refresh();
    },
    selectFacility(facilityId: number) {
      facilitySelect.value = String(facilityId);
      selectedNodeId = null;
      activeLookup = null;
      void refresh();
    },
  };
}
