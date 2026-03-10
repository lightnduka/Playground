import {
  Component,
  ElementRef,
  HostListener,
  ViewChild,
  signal,
  computed,
  ChangeDetectionStrategy,
  OnInit,
  Input
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

// --- Types & Interfaces ---

type ComponentType =
  | 'breaker'
  | 'isolator'
  | 'earth_switch'
  | 'transformer'
  | 'ct'
  | 'vt'
  | 'la'
  | 'busbar'
  | 'line';

interface Port {
  id: string;
  x: number; // local x
  y: number; // local y
}

interface ConnectionLink {
  sourceId: string;
  sourcePort: string;
  targetId: string;
  targetPort: string;
}

interface DiagramComponent {
  id: string;
  type: ComponentType;
  x: number;
  y: number;
  rotation: number;
  state: 'open' | 'closed';
  label?: string;
  labelOffset: { x: number; y: number };
  scale: number;
  color: string;
  length?: number;
}

interface ViewState {
  x: number;
  y: number;
  scale: number;
}

const SNAP_DIST = 20;

const COMPONENT_METADATA: Record<
  ComponentType,
  { ports: Port[]; category: string; defaultLabel?: string; defaultOffset: { x: number; y: number } }
> = {
  breaker: {
    category: 'Primary',
    ports: [
      { id: 't', x: 0, y: -15 },
      { id: 'b', x: 0, y: 15 },
      { id: 'l', x: -15, y: 0 },
      { id: 'r', x: 15, y: 0 }
    ],
    defaultLabel: 'CB',
    defaultOffset: { x: 0, y: 35 }
  },
  isolator: {
    category: 'Primary',
    ports: [
      { id: 't', x: 0, y: -20 },
      { id: 'b', x: 0, y: 20 },
      { id: 'l', x: -10, y: 0 },
      { id: 'r', x: 10, y: 0 }
    ],
    defaultLabel: 'DS',
    defaultOffset: { x: 30, y: 0 }
  },
  earth_switch: {
    category: 'Primary',
    ports: [
      { id: 't', x: 0, y: 0 },
      { id: 'b', x: 0, y: 10 },
      { id: 'l', x: -10, y: 0 },
      { id: 'r', x: 10, y: 0 }
    ],
    defaultLabel: 'ES',
    defaultOffset: { x: 0, y: 25 }
  },
  transformer: {
    category: 'Primary',
    ports: [
      { id: 't', x: 0, y: -26 },
      { id: 'b', x: 0, y: 26 },
      { id: 'l', x: -14, y: 0 },
      { id: 'r', x: 14, y: 0 }
    ],
    defaultLabel: 'TR',
    defaultOffset: { x: 40, y: 0 }
  },
  ct: {
    category: 'Protection',
    ports: [
      { id: 't', x: 0, y: -7 },
      { id: 'b', x: 0, y: 7 },
      { id: 'l', x: -12, y: 0 },
      { id: 'r', x: 12, y: 0 }
    ],
    defaultLabel: 'CT',
    defaultOffset: { x: 0, y: 20 }
  },
  vt: {
    category: 'Protection',
    ports: [
      { id: 't', x: 0, y: -25 },
      { id: 'b', x: 0, y: 12 },
      { id: 'l', x: -6, y: 0 },
      { id: 'r', x: 6, y: 0 }
    ],
    defaultLabel: 'VT',
    defaultOffset: { x: 20, y: 0 }
  },
  la: {
    category: 'Protection',
    ports: [
      { id: 't', x: 0, y: -15 },
      { id: 'b', x: 0, y: 25 },
      { id: 'l', x: -6, y: 0 },
      { id: 'r', x: 6, y: 0 }
    ],
    defaultLabel: 'LA',
    defaultOffset: { x: 20, y: 0 }
  },
  busbar: { category: 'Connections', ports: [], defaultLabel: 'BUSBAR', defaultOffset: { x: 0, y: -20 } },
  line: {
    category: 'Connections',
    ports: [
      { id: 't', x: 0, y: -50 },
      { id: 'b', x: 0, y: 50 }
    ],
    defaultLabel: 'LINE',
    defaultOffset: { x: 15, y: 0 }
  }
};

const INITIAL_COMPONENTS: DiagramComponent[] = [];

// --- Utilities ---

const rotatePoint = (x: number, y: number, angle: number) => {
  const rad = (angle * Math.PI) / 180;
  return {
    x: x * Math.cos(rad) - y * Math.sin(rad),
    y: x * Math.sin(rad) + y * Math.cos(rad)
  };
};

const getLocalPorts = (comp: DiagramComponent) => {
  const meta = COMPONENT_METADATA[comp.type];
  if (comp.type === 'line' && comp.length) {
    return [
      { id: 't', x: 0, y: -comp.length / 2 },
      { id: 'b', x: 0, y: comp.length / 2 }
    ];
  }
  if (comp.type === 'busbar' && comp.length) {
    return [
      { id: 'l', x: 0, y: 0 },
      { id: 'r', x: comp.length, y: 0 }
    ];
  }
  return meta.ports;
};

const getGlobalPortPosition = (comp: DiagramComponent, portId: string) => {
  const ports = getLocalPorts(comp);
  const port = ports.find((p) => p.id === portId) || ports[0];
  const rotated = rotatePoint(port.x * comp.scale, port.y * comp.scale, comp.rotation);
  return { x: comp.x + rotated.x, y: comp.y + rotated.y };
};

const getDistanceFromLineSegment = (px: number, py: number, x1: number, y1: number, x2: number, y2: number) => {
  const A = px - x1;
  const B = py - y1;
  const C = x2 - x1;
  const D = y2 - y1;

  const dot = A * C + B * D;
  const len_sq = C * C + D * D;
  let param = -1;
  if (len_sq !== 0) param = dot / len_sq;

  let xx, yy;

  if (param < 0) {
    xx = x1;
    yy = y1;
  } else if (param > 1) {
    xx = x2;
    yy = y2;
  } else {
    xx = x1 + param * C;
    yy = y1 + param * D;
  }

  const dx = px - xx;
  const dy = py - yy;
  return { distance: Math.sqrt(dx * dx + dy * dy), x: xx, y: yy };
};

// --- Icon Data ---
const ICONS: Record<string, string> = {
  zap: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
  undo2: 'M9 14 4 9l5-5 M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11',
  redo2: 'm15 14 5-5-5-5 M20 9H9.5A5.5 5.5 0 0 0 4 14.5v0A5.5 5.5 0 0 0 9.5 20H13',
  moon: 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z',
  sun: 'M12 2v2 M12 20v2 M4.93 4.93l1.41 1.41 M17.66 17.66l1.41 1.41 M2 12h2 M20 12h2 M6.34 17.66l-1.41 1.41 M19.07 4.93l-1.41 1.41 M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3',
  search: 'm21 21-4.3-4.3 M11 19a8 8 0 0 1-8-8 8 8 0 0 1 8-8 8 8 0 0 1 8 8 8 8 0 0 1-8 8Z',
  chevronRight: 'm9 18 6-6-6-6',
  chevronDown: 'm6 9 6 6 6-6',
  minus: 'M5 12h14',
  plus: 'M5 12h14 M12 5v14',
  maximize: 'M8 3H5a2 2 0 0 0-2 2v3 M16 3h3a2 2 0 0 1 2 2v3 M8 21H5a2 2 0 0 1-2-2v-3 M16 21h3a2 2 0 0 0 2-2v-3',
  layers: 'm12.83 2.18-10 5a1 1 0 0 0 0 1.78l10 5a1 1 0 0 0 .88 0l10-5a1 1 0 0 0 0-1.78l-10-5a1 1 0 0 0-.88 0Z M2 12l10 5 10-5 M2 17l10 5 10-5',
  x: 'M18 6 6 18 M6 6l12 12',
  type: 'M4 7V4h16v3 M9 20h6 M12 4v16',
  link2: 'M9 17H7A5 5 0 0 1 7 7h2 M15 7h2a5 5 0 1 1 0 10h-2 M8 12h8',
  palette:
    'M13.5 22.1c1.8-7.2 6.3-10.8 13.5-10.8 0-5.5-4.5-10-10-10C11.5 1.3 7 5.8 7 11.3c0 2.2.8 4.2 2.1 5.8v0c1.8 2.2 2.6 3.4 4.4 5Z M7 12c-4 0-5 4-5 6s4.5 5 5 5 3-5 5-6.5-1.5-2-2-2-3-2.5-3-2.5Z',
  rotateCw: 'M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8 M21 3v5h-5',
  trash2:
    'M3 6h18 M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6 M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2 M10 11v6 M14 11v6',
  activity: 'M22 12h-4l-3 9L9 3l-3 9H2',
  unlink:
    'M18.84 6.16a5.5 5.5 0 0 0-7.78 0L9 8.24M13 14l2.06 2.06a5.5 5.5 0 0 0 7.78-7.78l-1.06-1.06M8 12l-2.06-2.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06M11 10l2 2',
  copy: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1 M9 14h10a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H9a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2Z',
  power: 'M18.36 6.64a9 9 0 1 1-12.73 0 M12 2v10',
  image: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 15l-3-3 5-5 5 5 3-3 4 4',
  file: 'M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z',
  table: 'M3 3h18v18H3V3zm0 9h18M3 9h18M9 3v18',
  code: 'M16 18l6-6-6-6M8 6l-6 6 6 6'
};

// --- Icon Component ---
@Component({
  selector: 'app-icon',
  standalone: true,
  template: `
    <svg
      [attr.width]="size"
      [attr.height]="size"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path [attr.d]="path"></path>
    </svg>
  `
})
export class IconComponent implements OnInit {
  @Input() name: string = '';
  @Input() size: string | number = 24;
  path: string = '';

  ngOnInit() {
    this.path = ICONS[this.name] || '';
  }
}

// --- Main App Component ---
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="flex flex-col h-screen font-sans overflow-hidden transition-colors duration-500"
      [ngClass]="{ 'bg-[#000000] text-[#f5f5f5]': theme() === 'dark', 'bg-slate-50 text-slate-900': theme() === 'light' }"
    >
      <!-- Header -->
      <header
        class="h-16 border-b px-6 flex items-center justify-between z-30 shadow-2xl relative"
        [ngClass]="{ 'bg-[#0a0a0a] border-[#1a1a1a]': theme() === 'dark', 'bg-white border-slate-200': theme() === 'light' }"
      >
        <div class="flex items-center gap-4">
          <div class="bg-[#1a1a1a] p-2.5 rounded-xl text-white border border-[#262626] shadow-xl">
            <app-icon name="zap" size="20"></app-icon>
          </div>
          <div>
            <h1 class="text-lg font-black tracking-tight uppercase italic">
              Substation<span class="text-neutral-500 font-light">Architect</span>
            </h1>
            <p class="text-[9px] font-black text-neutral-600 uppercase tracking-[0.3em]">Carbon Edition</p>
          </div>
        </div>

        <div class="flex items-center gap-2 bg-[#141414] p-1.5 rounded-2xl border border-[#262626]">
          <button
            (click)="undo()"
            [disabled]="history().length === 0"
            class="p-2 rounded-xl transition-all"
            [ngClass]="history().length > 0 ? 'text-white hover:bg-neutral-800' : 'text-neutral-700 cursor-not-allowed'"
            title="Undo (Ctrl+Z)"
          >
            <app-icon name="undo2" size="18"></app-icon>
          </button>
          <button
            (click)="redo()"
            [disabled]="future().length === 0"
            class="p-2 rounded-xl transition-all"
            [ngClass]="future().length > 0 ? 'text-white hover:bg-neutral-800' : 'text-neutral-700 cursor-not-allowed'"
            title="Redo (Ctrl+Shift+Z)"
          >
            <app-icon name="redo2" size="18"></app-icon>
          </button>
        </div>

        <div class="flex items-center gap-4">
          <button
            (click)="toggleTheme()"
            class="p-2.5 rounded-xl transition-all active:scale-90"
            [ngClass]="theme() === 'dark' ? 'bg-[#1a1a1a] text-yellow-500 border border-[#262626]' : 'bg-slate-100'"
          >
            <app-icon [name]="theme() === 'light' ? 'moon' : 'sun'" size="20"></app-icon>
          </button>
          <div class="w-px h-6 bg-[#262626]"></div>

          <div class="relative">
            <button
              (click)="toggleExportMenu()"
              class="flex items-center gap-2 px-5 py-2.5 text-[10px] font-black uppercase tracking-widest bg-[#f5f5f5] text-black hover:bg-white rounded-xl transition-all shadow-xl active:scale-95"
            >
              <app-icon name="download" size="16"></app-icon>
              Export
              <app-icon name="chevronDown" size="12"></app-icon>
            </button>

            @if (isExportMenuOpen()) {
              <div
                class="absolute right-0 top-12 w-48 rounded-2xl border shadow-2xl p-2 z-50 flex flex-col gap-1"
                [ngClass]="theme() === 'dark' ? 'bg-[#0a0a0a] border-[#1a1a1a]' : 'bg-white border-slate-200'"
              >
                <button
                  (click)="exportAs('jpg')"
                  class="flex items-center gap-3 w-full p-2.5 rounded-xl text-xs font-bold transition-colors text-left"
                  [ngClass]="theme() === 'dark' ? 'hover:bg-[#1a1a1a] text-neutral-300' : 'hover:bg-slate-100 text-neutral-700'"
                >
                  <app-icon name="image" size="14"></app-icon>
                  JPG Image
                </button>
                <button
                  (click)="exportAs('pdf')"
                  class="flex items-center gap-3 w-full p-2.5 rounded-xl text-xs font-bold transition-colors text-left"
                  [ngClass]="theme() === 'dark' ? 'hover:bg-[#1a1a1a] text-neutral-300' : 'hover:bg-slate-100 text-neutral-700'"
                >
                  <app-icon name="file" size="14"></app-icon>
                  Print / PDF
                </button>
                <button
                  (click)="exportAs('excel')"
                  class="flex items-center gap-3 w-full p-2.5 rounded-xl text-xs font-bold transition-colors text-left"
                  [ngClass]="theme() === 'dark' ? 'hover:bg-[#1a1a1a] text-neutral-300' : 'hover:bg-slate-100 text-neutral-700'"
                >
                  <app-icon name="table" size="14"></app-icon>
                  Excel (CSV)
                </button>
                <div class="h-px bg-[#262626] mx-2 my-1"></div>
                <button
                  (click)="exportAs('json')"
                  class="flex items-center gap-3 w-full p-2.5 rounded-xl text-xs font-bold transition-colors text-left"
                  [ngClass]="theme() === 'dark' ? 'hover:bg-[#1a1a1a] text-neutral-300' : 'hover:bg-slate-100 text-neutral-700'"
                >
                  <app-icon name="file" size="14"></app-icon>
                  Save JSON
                </button>
                <button
                  (click)="exportAs('dxf')"
                  class="flex items-center gap-3 w-full p-2.5 rounded-xl text-xs font-bold transition-colors text-left"
                  [ngClass]="theme() === 'dark' ? 'hover:bg-[#1a1a1a] text-neutral-300' : 'hover:bg-slate-100 text-neutral-700'"
                >
                  <app-icon name="code" size="14"></app-icon>
                  CAD (DXF)
                </button>
              </div>
            }
          </div>
        </div>
      </header>

      <div class="flex flex-1 overflow-hidden relative" (click)="closeExportMenu()">
        <!-- Sidebar -->
        <aside
          class="w-72 border-r flex flex-col z-20 shadow-2xl"
          (click)="$event.stopPropagation()"
          [ngClass]="{ 'bg-[#0a0a0a] border-[#1a1a1a]': theme() === 'dark', 'bg-white border-slate-200': theme() === 'light' }"
        >
          <div class="p-5">
            <div class="relative group">
              <span class="absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-600">
                <app-icon name="search" size="16"></app-icon>
              </span>
              <input
                type="text"
                placeholder="QUERY EQUIPMENT..."
                [ngModel]="searchTerm()"
                (ngModelChange)="searchTerm.set($event)"
                class="w-full pl-11 pr-4 py-3 rounded-2xl text-[11px] font-black outline-none transition-all focus:ring-1 focus:ring-neutral-700"
                [ngClass]="{ 'bg-[#000000] border-[#1a1a1a] text-neutral-200': theme() === 'dark', 'bg-slate-50 border-slate-200': theme() === 'light' }"
              />
            </div>
          </div>

          <div class="flex-1 overflow-y-auto p-4 pt-0 space-y-4 scrollbar-hide">
            @for (group of filteredGroups(); track group.name) {
              <div
                class="rounded-2xl overflow-hidden border"
                [ngClass]="{ 'bg-[#0a0a0a] border-[#1a1a1a]': theme() === 'dark', 'bg-slate-50': theme() === 'light' }"
              >
                <button
                  (click)="toggleGroup(group.name)"
                  class="w-full flex items-center justify-between p-4 text-[9px] font-black uppercase tracking-[0.2em] text-neutral-500 hover:text-white transition-colors"
                >
                  {{ group.name }}
                  <app-icon [name]="isGroupCollapsed(group.name) ? 'chevronRight' : 'chevronDown'" size="14"></app-icon>
                </button>

                @if (!isGroupCollapsed(group.name)) {
                  <div
                    class="p-3 grid grid-cols-2 gap-3 border-t border-[#1a1a1a]"
                    [ngClass]="theme() === 'dark' ? 'bg-[#050505]' : 'bg-white'"
                  >
                    @for (type of group.types; track type) {
                      <div
                        draggable="true"
                        (dragstart)="onDragStart($event, type)"
                        class="flex flex-col items-center justify-center p-4 border rounded-2xl cursor-grab active:cursor-grabbing transition-all hover:scale-105 group"
                        [ngClass]="
                          theme() === 'dark'
                            ? 'bg-[#0a0a0a] border-[#1a1a1a] hover:border-neutral-500'
                            : 'bg-white border-slate-100 hover:border-blue-500'
                        "
                      >
                        <div class="mb-3 text-neutral-500 group-hover:text-white">
                          <ng-container *ngTemplateOutlet="sidebarIcon; context: { $implicit: type }"></ng-container>
                        </div>
                        <span
                          class="text-[9px] font-black text-neutral-500 text-center uppercase tracking-tight group-hover:text-white"
                        >
                          {{ getComponentLabel(type) }}
                        </span>
                      </div>
                    }
                  </div>
                }
              </div>
            }
          </div>
        </aside>

        <!-- Main Canvas -->
        <main
          class="flex-1 relative overflow-hidden transition-all"
          [ngClass]="{ 'cursor-grabbing': dragMode() === 'pan', 'cursor-default': dragMode() !== 'pan' }"
          (mousedown)="handleMouseDown($event)"
          (mousemove)="handleMouseMove($event)"
          (mouseup)="handleMouseUp()"
          (wheel)="handleWheel($event)"
          (dragover)="$event.preventDefault()"
          (drop)="handleDrop($event)"
        >
          <svg #svgRef class="w-full h-full block">
            <defs>
              <pattern id="dotGrid" width="40" height="40" patternUnits="userSpaceOnUse">
                <circle cx="2" cy="2" r="1.5" [attr.fill]="theme() === 'dark' ? '#1a1a1a' : '#cbd5e1'" />
              </pattern>
            </defs>
            <g [attr.transform]="'translate(' + view().x + ', ' + view().y + ') scale(' + view().scale + ')'">
              <rect x="-40000" y="-40000" width="80000" height="80000" fill="url(#dotGrid)" />

              <!-- Components Loop -->
              @for (comp of components(); track comp.id) {
                <g
                  [attr.transform]="'translate(' + comp.x + ', ' + comp.y + ') rotate(' + comp.rotation + ')'"
                  class="transition-opacity duration-200"
                  [ngClass]="isSelected(comp.id) ? 'opacity-100' : 'opacity-80 hover:opacity-100'"
                >
                  <!-- Selection Box & Resizers -->
                  @if (isSelected(comp.id)) {
                    <g>
                      <rect
                        [attr.x]="comp.type === 'busbar' ? -5 : -35"
                        [attr.y]="-35"
                        [attr.width]="comp.type === 'busbar' ? (comp.length || 0) + 10 : 70"
                        height="70"
                        fill="none"
                        stroke="#525252"
                        stroke-width="1.5"
                        stroke-dasharray="6 3"
                      />
                      <circle
                        [attr.cx]="comp.type === 'busbar' ? comp.length : 30"
                        [attr.cy]="comp.type === 'busbar' ? 0 : 30"
                        r="6"
                        fill="#ffffff"
                        stroke="black"
                        stroke-width="2"
                        class="shadow-2xl transition-transform hover:scale-125"
                        [ngClass]="(comp.type === 'busbar' || comp.type === 'line') ? 'cursor-ew-resize' : 'cursor-nwse-resize'"
                        (mousedown)="handleResizeMouseDown($event, comp.id)"
                      />
                    </g>
                  }

                  <!-- Main Component Geometry -->
                  <g (mousedown)="handleComponentMouseDown($event, comp.id)">
                    <g [attr.transform]="'scale(' + comp.scale + ')'">
                      <!-- Hitbox -->
                      <rect
                        [attr.x]="comp.type === 'busbar' ? 0 : -35"
                        [attr.y]="comp.type === 'busbar' ? -25 : -35"
                        [attr.width]="comp.type === 'busbar' ? comp.length : 70"
                        [attr.height]="comp.type === 'busbar' ? 50 : 70"
                        fill="transparent"
                        class="cursor-grab active:cursor-grabbing"
                      />

                      <!-- SVG Switch -->
                      <ng-container [ngSwitch]="comp.type">
                        <g *ngSwitchCase="'breaker'">
                          <rect
                            x="-15"
                            y="-15"
                            width="30"
                            height="30"
                            [attr.fill]="comp.state === 'closed' ? '#dc2626' : 'transparent'"
                            [attr.stroke]="comp.color"
                            stroke-width="2"
                            rx="2"
                            vector-effect="non-scaling-stroke"
                          />
                          @if (comp.state === 'open') {
                            <line
                              x1="-15"
                              y1="-15"
                              x2="15"
                              y2="15"
                              [attr.stroke]="comp.color"
                              stroke-width="2"
                              vector-effect="non-scaling-stroke"
                            />
                          }
                        </g>
                        <g *ngSwitchCase="'isolator'">
                          <line
                            x1="0"
                            y1="-20"
                            x2="0"
                            y2="-8"
                            [attr.stroke]="comp.color"
                            stroke-width="2"
                            vector-effect="non-scaling-stroke"
                          />
                          <line
                            x1="0"
                            y1="20"
                            x2="0"
                            y2="8"
                            [attr.stroke]="comp.color"
                            stroke-width="2"
                            vector-effect="non-scaling-stroke"
                          />
                          <line
                            x1="0"
                            y1="-8"
                            [attr.x2]="comp.state === 'closed' ? 0 : 10"
                            [attr.y2]="comp.state === 'closed' ? 8 : 5"
                            [attr.stroke]="comp.color"
                            stroke-width="2"
                            vector-effect="non-scaling-stroke"
                          />
                          <line
                            x1="-5"
                            y1="-8"
                            x2="5"
                            y2="-8"
                            [attr.stroke]="comp.color"
                            stroke-width="2"
                            vector-effect="non-scaling-stroke"
                          />
                        </g>
                        <g *ngSwitchCase="'transformer'">
                          <circle
                            cx="0"
                            cy="-12"
                            r="14"
                            fill="transparent"
                            [attr.stroke]="comp.color"
                            stroke-width="2"
                            vector-effect="non-scaling-stroke"
                          />
                          <circle
                            cx="0"
                            cy="12"
                            r="14"
                            fill="transparent"
                            [attr.stroke]="comp.color"
                            stroke-width="2"
                            vector-effect="non-scaling-stroke"
                          />
                        </g>
                        <g *ngSwitchCase="'busbar'">
                          <line
                            x1="0"
                            y1="0"
                            [attr.x2]="comp.length"
                            y2="0"
                            [attr.stroke]="comp.color"
                            stroke-width="2"
                            vector-effect="non-scaling-stroke"
                          />
                        </g>
                        <g *ngSwitchCase="'line'">
                          <line
                            x1="0"
                            [attr.y1]="-(comp.length || 100) / 2"
                            x2="0"
                            [attr.y2]="(comp.length || 100) / 2"
                            [attr.stroke]="comp.color"
                            stroke-width="2"
                            vector-effect="non-scaling-stroke"
                          />
                          <circle cx="0" [attr.cy]="-(comp.length || 100) / 2" r="3" [attr.fill]="comp.color" vector-effect="non-scaling-stroke" />
                          <circle cx="0" [attr.cy]="(comp.length || 100) / 2" r="3" [attr.fill]="comp.color" vector-effect="non-scaling-stroke" />
                        </g>
                        <g *ngSwitchCase="'ct'">
                          <circle
                            cx="0"
                            cy="0"
                            r="7"
                            fill="transparent"
                            [attr.stroke]="comp.color"
                            stroke-width="2"
                            vector-effect="non-scaling-stroke"
                          />
                          <line
                            x1="-12"
                            y1="0"
                            x2="12"
                            y2="0"
                            [attr.stroke]="comp.color"
                            stroke-width="2"
                            vector-effect="non-scaling-stroke"
                          />
                        </g>
                        <g *ngSwitchCase="'vt'">
                          <circle
                            cx="0"
                            cy="-6"
                            r="6"
                            fill="transparent"
                            [attr.stroke]="comp.color"
                            stroke-width="2"
                            vector-effect="non-scaling-stroke"
                          />
                          <circle
                            cx="0"
                            cy="6"
                            r="6"
                            fill="transparent"
                            [attr.stroke]="comp.color"
                            stroke-width="2"
                            vector-effect="non-scaling-stroke"
                          />
                          <line
                            x1="0"
                            y1="-25"
                            x2="0"
                            y2="-12"
                            [attr.stroke]="comp.color"
                            stroke-width="2"
                            vector-effect="non-scaling-stroke"
                          />
                        </g>
                        <g *ngSwitchCase="'la'">
                          <rect
                            x="-6"
                            y="-15"
                            width="12"
                            height="30"
                            fill="transparent"
                            [attr.stroke]="comp.color"
                            stroke-width="2"
                            vector-effect="non-scaling-stroke"
                          />
                          <line
                            x1="-6"
                            y1="-5"
                            x2="6"
                            y2="5"
                            [attr.stroke]="comp.color"
                            stroke-width="1"
                            vector-effect="non-scaling-stroke"
                          />
                          <line
                            x1="6"
                            y1="-5"
                            x2="-6"
                            y2="5"
                            [attr.stroke]="comp.color"
                            stroke-width="1"
                            vector-effect="non-scaling-stroke"
                          />
                          <line
                            x1="0"
                            y1="15"
                            x2="0"
                            y2="25"
                            [attr.stroke]="comp.color"
                            stroke-width="2"
                            vector-effect="non-scaling-stroke"
                          />
                        </g>
                        <g *ngSwitchCase="'earth_switch'">
                          <line
                            x1="0"
                            y1="0"
                            [attr.x2]="comp.state === 'closed' ? 15 : 10"
                            [attr.y2]="comp.state === 'closed' ? 0 : -5"
                            [attr.stroke]="comp.color"
                            stroke-width="2"
                            vector-effect="non-scaling-stroke"
                          />
                          <line x1="15" y1="-8" x2="15" y2="8" [attr.stroke]="comp.color" stroke-width="2" vector-effect="non-scaling-stroke" />
                          <line x1="18" y1="-5" x2="18" y2="5" [attr.stroke]="comp.color" stroke-width="2" vector-effect="non-scaling-stroke" />
                          <line x1="21" y1="-2" x2="21" y2="2" [attr.stroke]="comp.color" stroke-width="2" vector-effect="non-scaling-stroke" />
                        </g>
                      </ng-container>

                      <!-- Pivot Label -->
                      <g [attr.transform]="'translate(' + comp.labelOffset.x + ', ' + comp.labelOffset.y + ')'" class="group/label">
                        <g [attr.transform]="'rotate(' + -comp.rotation + ')'">
                          @if (isSelected(comp.id)) {
                            <rect
                              x="-35"
                              y="-12"
                              width="70"
                              height="24"
                              fill="rgba(59, 130, 246, 0.15)"
                              stroke="#3b82f6"
                              stroke-width="1.5"
                              stroke-dasharray="4 2"
                              rx="2"
                              vector-effect="non-scaling-stroke"
                            />
                          }
                          <rect x="-40" y="-20" width="80" height="40" fill="transparent" class="cursor-move" (mousedown)="handleLabelMouseDown($event, comp.id)" />
                          <text
                            [attr.font-size]="12 / comp.scale"
                            [attr.fill]="theme() === 'dark' ? '#f5f5f5' : '#171717'"
                            font-weight="700"
                            text-anchor="middle"
                            dominant-baseline="middle"
                            style="pointer-events: none; user-select: none;"
                            [ngStyle]="{ 'text-shadow': theme() === 'dark' ? '0 0 8px rgba(0,0,0,1)' : '0 0 4px white' }"
                          >
                            {{ comp.label }}
                          </text>
                        </g>
                      </g>

                      <!-- Ports -->
                      @if (isSelected(comp.id)) {
                        @for (p of getPorts(comp); track p.id) {
                          <circle [attr.cx]="p.x" [attr.cy]="p.y" [attr.r]="2.5 / comp.scale" fill="#22c55e" vector-effect="non-scaling-stroke" />
                        }
                      }
                    </g>
                  </g>
                </g>
              }

              <!-- Snap Indicator -->
              @if (snapIndicator()) {
                <g [attr.transform]="'translate(' + snapIndicator()!.x + ', ' + snapIndicator()!.y + ')'">
                  <circle r="12" fill="rgba(34, 197, 94, 0.2)" class="animate-ping" />
                  <circle r="5" fill="#22c55e" />
                </g>
              }

              <!-- Marquee -->
              @if (marqueeBox()) {
                <rect
                  [attr.x]="min(marqueeBox()!.x1, marqueeBox()!.x2)"
                  [attr.y]="min(marqueeBox()!.y1, marqueeBox()!.y2)"
                  [attr.width]="abs(marqueeBox()!.x1 - marqueeBox()!.x2)"
                  [attr.height]="abs(marqueeBox()!.y1 - marqueeBox()!.y2)"
                  fill="rgba(59, 130, 246, 0.08)"
                  stroke="#3b82f6"
                  stroke-width="2"
                  stroke-dasharray="4 4"
                />
              }
            </g>
          </svg>

          <!-- Floating View Controls -->
          <div
            class="absolute bottom-8 left-8 flex items-center gap-1 p-2 rounded-2xl shadow-2xl border backdrop-blur-md"
            [ngClass]="{ 'bg-[#0a0a0a]/80 border-[#1a1a1a]': theme() === 'dark', 'bg-white/80 border-slate-200': theme() === 'light' }"
          >
            <button (click)="adjustZoom(-0.2)" class="p-2.5 hover:bg-[#1a1a1a] rounded-xl transition-colors">
              <app-icon name="minus" size="18"></app-icon>
            </button>
            <div class="w-16 text-center text-[10px] font-black tracking-widest text-neutral-500">{{ round(view().scale * 100) }}%</div>
            <button (click)="adjustZoom(0.2)" class="p-2.5 hover:bg-[#1a1a1a] rounded-xl transition-colors">
              <app-icon name="plus" size="18"></app-icon>
            </button>
            <div class="w-px h-6 mx-1" [ngClass]="theme() === 'dark' ? 'bg-[#1a1a1a]' : 'bg-slate-200'"></div>
            <button (click)="resetView()" class="p-2.5 hover:bg-[#1a1a1a] rounded-xl transition-colors">
              <app-icon name="maximize" size="18"></app-icon>
            </button>
          </div>
        </main>

        <!-- Properties Panel -->
        <aside
          class="transition-all duration-300 border-l flex flex-col h-full"
          (click)="$event.stopPropagation()"
          [ngClass]="[
            theme() === 'dark' ? 'bg-[#0a0a0a] border-[#1a1a1a]' : 'bg-white border-slate-200',
            selectedIds().length > 0 ? 'w-80' : 'w-0 overflow-hidden'
          ]"
        >
          <div class="p-6 border-b flex items-center justify-between bg-[#050505]/50 border-[#1a1a1a]">
            <div class="flex items-center gap-2">
              <div class="p-2 bg-blue-500/10 rounded-lg text-blue-500"><app-icon name="layers" size="16"></app-icon></div>
              <h3 class="font-black text-[10px] uppercase tracking-[0.3em]">
                {{ selectedIds().length > 1 ? 'GROUP (' + selectedIds().length + ')' : 'PROPERTIES' }}
              </h3>
            </div>
            <button (click)="selectedIds.set([])" class="p-2 hover:bg-[#1a1a1a] rounded-xl text-neutral-600 transition-colors">
              <app-icon name="x" size="18"></app-icon>
            </button>
          </div>

          <div class="flex-1 overflow-y-auto p-6 space-y-8 scrollbar-hide">
            <!-- Single Selection Properties -->
            @if (selectedIds().length === 1 && selectedComp(); as comp) {
              <section class="space-y-6">
                <div>
                  <label class="text-[9px] font-black text-neutral-600 uppercase tracking-[0.2em] block mb-3">Annotation Tag</label>
                  <div class="bg-black border border-[#1a1a1a] rounded-2xl px-4 py-3.5 flex items-center gap-3 focus-within:border-neutral-500">
                    <app-icon name="type" size="14" class="text-neutral-700"></app-icon>
                    <input
                      class="w-full bg-transparent outline-none font-bold text-xs text-white"
                      [ngModel]="comp.label"
                      (ngModelChange)="updateLabel($event)"
                    />
                  </div>
                </div>

                @if (['breaker', 'isolator', 'earth_switch'].includes(comp.type)) {
                  <div>
                    <label class="text-[9px] font-black text-neutral-600 uppercase tracking-[0.2em] block mb-2 flex items-center gap-2">
                      <app-icon name="power" size="14"></app-icon>
                      Operational State
                    </label>
                    <button
                      (click)="toggleState()"
                      class="w-full py-3 rounded-xl font-bold text-xs transition-all border flex items-center justify-center gap-2"
                      [ngClass]="
                        comp.state === 'closed'
                          ? 'bg-red-500/10 text-red-500 border-red-500/20 hover:bg-red-500/20'
                          : 'bg-green-500/10 text-green-500 border-green-500/20 hover:bg-green-500/20'
                      "
                    >
                      {{ comp.state === 'closed' ? 'CLOSED (I)' : 'OPEN (O)' }}
                    </button>
                  </div>
                }

                <div class="grid grid-cols-2 gap-4">
                  <div>
                    <label class="text-[9px] font-black text-neutral-600 uppercase tracking-[0.2em] block mb-2">Scale</label>
                    <input
                      type="number"
                      step="0.1"
                      class="w-full bg-black border border-[#1a1a1a] rounded-xl p-3 text-xs font-bold text-white outline-none"
                      [ngModel]="comp.scale.toFixed(1)"
                      (ngModelChange)="updateScale($event)"
                    />
                  </div>
                  @if (comp.type === 'busbar' || comp.type === 'line') {
                    <div>
                      <label class="text-[9px] font-black text-neutral-600 uppercase tracking-[0.2em] block mb-2">Length</label>
                      <input
                        type="number"
                        class="w-full bg-black border border-[#1a1a1a] rounded-xl p-3 text-xs font-bold text-white outline-none"
                        [ngModel]="round(comp.length || 0)"
                        (ngModelChange)="updateLength($event)"
                      />
                    </div>
                  }
                </div>
              </section>

              <section>
                <label class="text-[9px] font-black text-neutral-600 uppercase tracking-[0.2em] block mb-4 flex items-center gap-2">
                  <app-icon name="link2" size="14"></app-icon>
                  Active Topology
                </label>
                <div class="space-y-2">
                  @if (activeTopology().length > 0) {
                    @for (conn of activeTopology(); track conn.id) {
                      <button
                        (click)="selectedIds.set([conn.id])"
                        class="w-full flex items-center justify-between p-4 border rounded-2xl transition-all text-left bg-black border-[#1a1a1a] hover:border-blue-500 group shadow-sm"
                      >
                        <div class="flex items-center gap-4">
                          <div class="p-2 bg-[#0a0a0a] rounded-xl text-neutral-600 group-hover:text-blue-500 transition-colors">
                            <ng-container *ngTemplateOutlet="sidebarIcon; context: { $implicit: conn.type }"></ng-container>
                          </div>
                          <div>
                            <p class="text-[10px] font-black text-neutral-300 uppercase tracking-tighter">{{ conn.label }}</p>
                            <p class="text-[8px] font-bold text-blue-600 uppercase">{{ conn.relation }}</p>
                          </div>
                        </div>
                        <div class="flex items-center gap-2">
                          <div
                            (click)="detachComponent(conn.id); $event.stopPropagation()"
                            class="p-2 text-neutral-600 hover:text-red-500 hover:bg-red-500/10 rounded-full transition-colors"
                            title="Disconnect"
                          >
                            <app-icon name="unlink" size="14"></app-icon>
                          </div>
                          <app-icon name="chevronRight" size="14" class="text-neutral-700 group-hover:text-white"></app-icon>
                        </div>
                      </button>
                    }
                  } @else {
                    <div class="p-10 border border-dashed border-[#1a1a1a] rounded-3xl text-center bg-[#050505]">
                      <p class="text-[8px] font-black uppercase text-neutral-700 tracking-[0.2em]">Disconnected Node</p>
                    </div>
                  }
                </div>
              </section>
            }

            <!-- Common Properties -->
            <section class="space-y-6">
              <div>
                <label class="text-[9px] font-black text-neutral-600 uppercase tracking-[0.2em] block mb-4 flex items-center gap-2">
                  <app-icon name="palette" size="14"></app-icon>
                  {{ selectedIds().length > 1 ? 'Bulk Color' : 'Color System' }}
                </label>
                <div class="grid grid-cols-5 gap-3">
                  @for (c of vibrantPalette; track c) {
                    <button
                      (click)="setBulkColor(c)"
                      class="w-9 h-9 rounded-xl border-2 transition-all"
                      [ngStyle]="{ backgroundColor: c }"
                      [ngClass]="
                        selectedIds().length === 1 && selectedComp()?.color === c
                          ? 'border-white scale-125 shadow-[0_0_10px_rgba(255,255,255,0.2)]'
                          : 'border-[#1a1a1a] hover:border-neutral-600'
                      "
                    ></button>
                  }
                </div>
              </div>
            </section>

            <section class="pt-6 border-t border-[#1a1a1a] grid grid-cols-2 gap-3">
              <button
                (click)="rotateSelected()"
                class="flex items-center justify-center gap-2 py-4 text-[9px] font-black uppercase tracking-widest rounded-2xl transition-all active:scale-95 bg-black text-neutral-400 border border-[#1a1a1a] hover:text-white hover:border-neutral-500"
              >
                <app-icon name="rotateCw" size="14"></app-icon>
                Group Pivot
              </button>
              <button
                (click)="duplicateSelected()"
                class="flex items-center justify-center gap-2 py-4 text-[9px] font-black uppercase tracking-widest rounded-2xl transition-all active:scale-95 bg-black text-neutral-400 border border-[#1a1a1a] hover:text-white hover:border-neutral-500"
              >
                <app-icon name="copy" size="14"></app-icon>
                Duplicate
              </button>
              <button
                (click)="deleteSelected()"
                class="col-span-2 flex items-center justify-center gap-2 py-4 text-[9px] font-black uppercase tracking-widest rounded-2xl transition-all active:scale-95 bg-[#260000] text-red-500 border border-red-900 hover:bg-red-600 hover:text-white"
              >
                <app-icon name="trash2" size="14"></app-icon>
                Wipe Selection
              </button>
            </section>
          </div>
        </aside>
      </div>
    </div>

    <!-- Reusable Template for Sidebar Icons -->
    <ng-template #sidebarIcon let-type>
      @switch (type) {
        @case ('breaker') {
          <svg width="18" height="18" viewBox="-20 -20 40 40"><rect x="-12" y="-12" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" /></svg>
        }
        @case ('isolator') {
          <svg width="18" height="18" viewBox="-20 -20 40 40">
            <line x1="0" y1="-18" x2="0" y2="-8" stroke="currentColor" stroke-width="2" />
            <line x1="0" y1="18" x2="0" y2="8" stroke="currentColor" stroke-width="2" />
            <line x1="0" y1="-8" x2="10" y2="4" stroke="currentColor" stroke-width="2" />
          </svg>
        }
        @case ('transformer') {
          <svg width="18" height="18" viewBox="-20 -20 40 40">
            <circle cx="0" cy="-7" r="8" fill="none" stroke="currentColor" stroke-width="2" />
            <circle cx="0" cy="7" r="8" fill="none" stroke="currentColor" stroke-width="2" />
          </svg>
        }
        @case ('busbar') {
          <div class="w-8 h-0.5 bg-white rounded-full"></div>
        }
        @case ('line') {
          <div class="w-0.5 h-6 bg-neutral-500 rounded-full"></div>
        }
        @case ('ct') {
          <svg width="18" height="18" viewBox="-20 -20 40 40">
            <circle cx="0" cy="0" r="8" fill="none" stroke="currentColor" stroke-width="2" />
            <line x1="-12" y1="0" x2="12" y2="0" stroke="currentColor" stroke-width="2" />
          </svg>
        }
        @case ('vt') {
          <svg width="18" height="18" viewBox="-20 -20 40 40">
            <circle cx="0" cy="-6" r="6" fill="none" stroke="currentColor" stroke-width="2" />
            <circle cx="0" cy="6" r="6" fill="none" stroke="currentColor" stroke-width="2" />
            <line x1="0" y1="-25" x2="0" y2="-12" stroke="currentColor" stroke-width="2" />
          </svg>
        }
        @case ('la') {
          <svg width="18" height="18" viewBox="-20 -20 40 40">
            <rect x="-5" y="-10" width="10" height="20" fill="none" stroke="currentColor" stroke-width="2" />
            <line x1="-5" y1="-4" x2="5" y2="4" stroke="currentColor" />
            <line x1="5" y1="-4" x2="-5" y2="4" stroke="currentColor" />
          </svg>
        }
        @case ('earth_switch') {
          <svg width="18" height="18" viewBox="-20 -20 40 40">
            <line x1="-10" y1="0" x2="10" y2="0" stroke="currentColor" stroke-width="2" />
            <line x1="-6" y1="5" x2="6" y2="5" stroke="currentColor" stroke-width="2" />
            <line x1="0" y1="0" x2="0" y2="-10" stroke="currentColor" stroke-width="2" />
          </svg>
        }
        @default {
          <app-icon name="activity" size="18"></app-icon>
        }
      }
    </ng-template>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .scrollbar-hide::-webkit-scrollbar {
        display: none;
      }
      .scrollbar-hide {
        -ms-overflow-style: none;
        scrollbar-width: none;
      }
    `
  ]
})
export class App {
  // --- Signals & State ---
  components = signal<DiagramComponent[]>(INITIAL_COMPONENTS);
  connections = signal<ConnectionLink[]>([]);
  selectedIds = signal<string[]>([]);
  view = signal<ViewState>({ x: 0, y: 0, scale: 1 });
  searchTerm = signal('');
  collapsedGroups = signal<Record<string, boolean>>({});
  theme = signal<'light' | 'dark'>('dark');
  isExportMenuOpen = signal(false);

  history = signal<DiagramComponent[][]>([]);
  future = signal<DiagramComponent[][]>([]);

  // Dragging state (not signals to avoid rapid effect triggering during high-freq mousemove)
  dragMode = signal<'none' | 'move' | 'resize' | 'label' | 'pan' | 'marquee'>('none');
  dragStart = { x: 0, y: 0 };
  groupStartPositions: Record<string, { x: number; y: number }> = {};
  itemStart: any = null;

  // Visual indicators
  snapIndicator = signal<{ x: number; y: number } | null>(null);
  marqueeBox = signal<{ x1: number; y1: number; x2: number; y2: number } | null>(null);

  @ViewChild('svgRef') svgRef!: ElementRef<SVGSVGElement>;

  vibrantPalette = ['#ef4444', '#f97316', '#f59e0b', '#84cc16', '#10b981', '#06b6d4', '#3b82f6', '#8b5cf6', '#d946ef', '#ffffff'];

  // --- Computed ---

  selectedComp = computed(() => {
    const ids = this.selectedIds();
    if (ids.length !== 1) return null;
    return this.components().find((c) => c.id === ids[0]) || null;
  });

  filteredGroups = computed(() => {
    const term = this.searchTerm().toLowerCase();
    const groupsList: Record<string, ComponentType[]> = {
      'Primary Equipment': ['breaker', 'isolator', 'earth_switch', 'transformer'],
      'Protection & Metering': ['ct', 'vt', 'la'],
      Connections: ['busbar', 'line']
    };

    return Object.entries(groupsList)
      .map(([name, types]) => {
        const filtered = types.filter(
          (type) => type.toLowerCase().includes(term) || COMPONENT_METADATA[type].defaultLabel?.toLowerCase().includes(term)
        );
        return { name, types: filtered };
      })
      .filter((g) => g.types.length > 0);
  });

  activeTopology = computed(() => {
    const target = this.selectedComp();
    if (!target) return [];

    const myPorts = this.getGlobalPorts(target);
    // Explicit relations from connections array would be checked here in a real graph,
    // but for this visual tool, we check geometric proximity.

    const results: { id: string; type: string; label: string; relation: string }[] = [];

    this.components().forEach((other) => {
      if (other.id === target.id) return;

      // Check for Busbar <-> Component overlap
      if (target.type === 'busbar') {
        // Is the OTHER component on this busbar?
        const otherPorts = this.getGlobalPorts(other);
        const onBus = otherPorts.some((op) => {
          const rotRad = (target.rotation * Math.PI) / 180;
          const x2 = target.x + (target.length || 100) * Math.cos(rotRad);
          const y2 = target.y + (target.length || 100) * Math.sin(rotRad);
          const dist = getDistanceFromLineSegment(op.x, op.y, target.x, target.y, x2, y2).distance;
          return dist < 5;
        });
        if (onBus) results.push({ id: other.id, type: other.type, label: String(other.label || other.type), relation: 'Bonded Equipment' });
      } else if (other.type === 'busbar') {
        // Is THIS component on the other busbar?
        const myPorts = this.getGlobalPorts(target);
        const onBus = myPorts.some((mp) => {
          const rotRad = (other.rotation * Math.PI) / 180;
          const x2 = other.x + (other.length || 100) * Math.cos(rotRad);
          const y2 = other.y + (other.length || 100) * Math.sin(rotRad);
          const dist = getDistanceFromLineSegment(mp.x, mp.y, other.x, other.y, x2, y2).distance;
          return dist < 5;
        });
        if (onBus) results.push({ id: other.id, type: other.type, label: String(other.label || 'Busbar'), relation: 'Power Rail' });
      } else {
        // Standard port-to-port
        const otherPorts = this.getGlobalPorts(other);
        const isConnected = myPorts.some((mp) => otherPorts.some((op) => Math.hypot(mp.x - op.x, mp.y - op.y) < 5));
        if (isConnected) results.push({ id: other.id, type: other.type, label: String(other.label || other.type.toUpperCase()), relation: 'Terminal Link' });
      }
    });
    return results;
  });

  // --- Logic ---

  screenToSVG(clientX: number, clientY: number) {
    if (!this.svgRef) return { x: 0, y: 0 };
    const svg = this.svgRef.nativeElement;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    return pt.matrixTransform(ctm.inverse());
  }

  getPorts(comp: DiagramComponent) {
    return getLocalPorts(comp);
  }

  getGlobalPorts(comp: DiagramComponent) {
    const localPorts = getLocalPorts(comp);
    return localPorts.map((p) => {
      const scaledP = { x: p.x * comp.scale, y: p.y * comp.scale };
      const rotated = rotatePoint(scaledP.x, scaledP.y, comp.rotation);
      return { id: `${comp.id}-${p.id}`, x: comp.x + rotated.x, y: comp.y + rotated.y, compId: comp.id };
    });
  }

  // --- Actions ---

  undo() {
    const history = this.history();
    if (history.length === 0) return;
    const previous = history[history.length - 1];

    this.future.update((f) => [[...this.components()], ...f]);
    this.history.update((h) => h.slice(0, -1));
    this.components.set(previous);
  }

  redo() {
    const future = this.future();
    if (future.length === 0) return;
    const next = future[0];

    this.history.update((h) => [...h, [...this.components()]]);
    this.future.update((f) => f.slice(1));
    this.components.set(next);
  }

  commitToHistory(newState: DiagramComponent[]) {
    this.history.update((h) => [...h, [...this.components()]]);
    this.future.set([]);
    this.components.set(newState);
  }

  resolveConstraints(currentComponents: DiagramComponent[]): DiagramComponent[] {
    let next = [...currentComponents];
    let changed = true;
    let iterations = 0;
    const conns = this.connections();

    while (changed && iterations < 3) {
      changed = false;
      iterations++;

      const updated = next.map((comp) => {
        const myLocks = conns.filter((l) => l.sourceId === comp.id || l.targetId === comp.id);
        if (myLocks.length === 0 || comp.type !== 'line') return comp;

        const lockT = conns.find((l) => (l.sourceId === comp.id && l.sourcePort === 't') || (l.targetId === comp.id && l.targetPort === 't'));
        const lockB = conns.find((l) => (l.sourceId === comp.id && l.sourcePort === 'b') || (l.targetId === comp.id && l.targetPort === 'b'));

        if (!lockT && !lockB) return comp;

        const getComp = (id: string) => next.find((c) => c.id === id);

        const getPos = (lock: ConnectionLink, myPort: string) => {
          const otherId = lock.sourceId === comp.id ? lock.targetId : lock.sourceId;
          const otherPort = lock.sourceId === comp.id ? lock.targetPort : lock.sourcePort;
          const otherComp = getComp(otherId);
          return otherComp ? getGlobalPortPosition(otherComp, otherPort) : getGlobalPortPosition(comp, myPort);
        };

        const posT = lockT ? getPos(lockT, 't') : getGlobalPortPosition(comp, 't');
        const posB = lockB ? getPos(lockB, 'b') : getGlobalPortPosition(comp, 'b');

        const newX = (posT.x + posB.x) / 2;
        const newY = (posT.y + posB.y) / 2;
        const newLen = Math.hypot(posB.x - posT.x, posB.y - posT.y);
        const newRot = Math.atan2(posB.y - posT.y, posB.x - posT.x) * (180 / Math.PI) - 90;

        if (
          Math.abs(comp.x - newX) > 0.1 ||
          Math.abs(comp.y - newY) > 0.1 ||
          Math.abs((comp.length || 0) - newLen) > 0.1 ||
          Math.abs(comp.rotation - newRot) > 0.1
        ) {
          changed = true;
          return { ...comp, x: newX, y: newY, length: newLen, rotation: newRot };
        }
        return comp;
      });
      next = updated;
    }
    return next;
  }

  detachComponent(otherId: string) {
    const id = this.selectedIds()[0];
    if (!id) return;

    // 1. Remove constraints
    const newConnections = this.connections().filter(
      (l) => !((l.sourceId === id && l.targetId === otherId) || (l.sourceId === otherId && l.targetId === id))
    );

    // 2. Nudge to break geometric bond
    const nextComponents = this.components().map((c) => {
      if (c.id === id) {
        return { ...c, x: c.x + 10, y: c.y + 10 };
      }
      return c;
    });

    this.commitToHistory(nextComponents);
    this.connections.set(newConnections);
  }

  duplicateSelected() {
    const ids = this.selectedIds();
    if (ids.length === 0) return;

    const newComps: DiagramComponent[] = [];
    const newIds: string[] = [];

    this.components().forEach((c) => {
      if (ids.includes(c.id)) {
        const newId = `${c.type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const copy: DiagramComponent = {
          ...c,
          id: newId,
          x: c.x + 20,
          y: c.y + 20
        };
        newComps.push(copy);
        newIds.push(newId);
      }
    });

    if (newComps.length > 0) {
      this.commitToHistory([...this.components(), ...newComps]);
      this.selectedIds.set(newIds);
    }
  }

  toggleState() {
    const id = this.selectedIds()[0];
    if (!id) return;
    const next = this.components().map((c) => {
      if (c.id === id) {
        return { ...c, state: c.state === 'closed' ? 'open' : 'closed' } as DiagramComponent;
      }
      return c;
    });
    this.commitToHistory(this.resolveConstraints(next));
  }

  // --- Export Functions ---
  toggleExportMenu() {
    this.isExportMenuOpen.set(!this.isExportMenuOpen());
  }

  closeExportMenu() {
    this.isExportMenuOpen.set(false);
  }

  exportAs(format: string) {
    this.closeExportMenu();
    switch (format) {
      case 'jpg':
        this.saveImage('jpeg');
        break;
      case 'json':
        this.saveJson();
        break;
      case 'excel':
        this.saveCsv();
        break;
      case 'dxf':
        this.saveDxf();
        break;
      case 'pdf':
        window.print();
        break;
    }
  }

  downloadFile(content: string, fileName: string, contentType: string) {
    const blob = new Blob([content], { type: contentType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  }

  saveJson() {
    const data = JSON.stringify(this.components(), null, 2);
    this.downloadFile(data, 'substation-design.json', 'application/json');
  }

  saveCsv() {
    let csv = 'ID,Type,Label,State,X,Y,Rotation\n';
    this.components().forEach((c) => {
      csv += `${c.id},${c.type},${c.label || ''},${c.state},${c.x},${c.y},${c.rotation}\n`;
    });
    this.downloadFile(csv, 'substation-bom.csv', 'text/csv');
  }

  saveDxf() {
    let dxf = '0\nSECTION\n2\nENTITIES\n';
    this.components().forEach((c) => {
      // Basic POINT export for now
      dxf += '0\nPOINT\n8\n0\n10\n' + c.x + '\n20\n' + -c.y + '\n30\n0.0\n';
      // Add TEXT for Label
      if (c.label) {
        dxf +=
          '0\nTEXT\n8\n0\n10\n' +
          (c.x + c.labelOffset.x) +
          '\n20\n' +
          -(c.y + c.labelOffset.y) +
          '\n30\n0.0\n40\n10\n1\n' +
          c.label +
          '\n';
      }
    });
    dxf += '0\nENDSEC\n0\nEOF';
    this.downloadFile(dxf, 'substation.dxf', 'application/dxf');
  }

  saveImage(type: 'png' | 'jpeg') {
    const svg = this.svgRef.nativeElement;
    const svgData = new XMLSerializer().serializeToString(svg);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();

    // Set dimensions based on current view or fixed size
    canvas.width = svg.clientWidth;
    canvas.height = svg.clientHeight;

    img.onload = () => {
      if (ctx) {
        if (type === 'jpeg') {
          ctx.fillStyle = this.theme() === 'dark' ? '#000000' : '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        ctx.drawImage(img, 0, 0);
        const url = canvas.toDataURL(`image/${type}`);
        const a = document.createElement('a');
        a.href = url;
        a.download = `substation-view.${type}`;
        a.click();
      }
    };
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
  }

  // --- Handlers ---

  @HostListener('window:keydown', ['$event'])
  handleKeyDown(e: KeyboardEvent) {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    const isMod = e.metaKey || e.ctrlKey;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      this.deleteSelected();
    }
    if (isMod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
    }
    if (isMod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      this.redo();
    }
    if (isMod && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      this.duplicateSelected();
    }
  }

  handleMouseDown(e: MouseEvent) {
    if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
      this.dragMode.set('pan');
      this.dragStart = { x: e.clientX, y: e.clientY };
    } else {
      const pt = this.screenToSVG(e.clientX, e.clientY);
      this.dragMode.set('marquee');
      this.dragStart = { x: pt.x, y: pt.y };
      this.marqueeBox.set({ x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y });
      if (!e.shiftKey && !e.metaKey && !e.ctrlKey) this.selectedIds.set([]);
    }
  }

  handleComponentMouseDown(e: MouseEvent, id: string) {
    e.stopPropagation();
    if (e.button !== 0) return;
    const isMulti = e.shiftKey || e.metaKey || e.ctrlKey;
    const currentSel = this.selectedIds();
    const nextIds = isMulti ? (currentSel.includes(id) ? currentSel.filter((i) => i !== id) : [...currentSel, id]) : [id];

    this.selectedIds.set(nextIds);
    this.dragMode.set('move');
    const svgPos = this.screenToSVG(e.clientX, e.clientY);
    this.dragStart = { x: svgPos.x, y: svgPos.y };

    // Identify implicit movers (followers)
    // Any non-line component attached to a selected Busbar should move with it
    const implicitMovers = new Set<string>(nextIds);
    const conns = this.connections();
    const comps = this.components();

    nextIds.forEach((selId) => {
      const selComp = comps.find((c) => c.id === selId);
      if (selComp && selComp.type === 'busbar') {
        // Find connected non-lines
        conns.forEach((link) => {
          if (link.sourceId === selId || link.targetId === selId) {
            const otherId = link.sourceId === selId ? link.targetId : link.sourceId;
            const otherComp = comps.find((c) => c.id === otherId);
            // Don't implicitly move lines (they stretch via resolveConstraints) or other busbars (complex)
            if (otherComp && otherComp.type !== 'line' && otherComp.type !== 'busbar') {
              implicitMovers.add(otherId);
            }
          }
        });
      }
    });

    const positions: Record<string, { x: number; y: number }> = {};
    comps.forEach((c) => {
      if (implicitMovers.has(c.id)) {
        positions[c.id] = { x: c.x, y: c.y };
      }
    });
    this.groupStartPositions = positions;
    this.itemStart = [...this.components()];
  }

  handleResizeMouseDown(e: MouseEvent, id: string) {
    e.stopPropagation();
    const comp = this.components().find((c) => c.id === id);
    if (!comp) return;
    this.dragMode.set('resize');
    const svgPos = this.screenToSVG(e.clientX, e.clientY);
    this.dragStart = { x: svgPos.x, y: svgPos.y };
    this.itemStart = { scale: comp.scale, length: comp.length, componentsAtStart: [...this.components()] };
  }

  handleLabelMouseDown(e: MouseEvent, id: string) {
    e.stopPropagation();
    const comp = this.components().find((c) => c.id === id);
    if (!comp) return;
    this.selectedIds.set([id]);
    this.dragMode.set('label');
    const svgPos = this.screenToSVG(e.clientX, e.clientY);
    this.dragStart = { x: svgPos.x, y: svgPos.y };
    this.itemStart = { labelOffset: { ...comp.labelOffset }, componentsAtStart: [...this.components()] };
  }

  handleMouseMove(e: MouseEvent) {
    const mode = this.dragMode();
    if (mode === 'pan') {
      const dx = e.clientX - this.dragStart.x;
      const dy = e.clientY - this.dragStart.y;
      this.view.update((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
      this.dragStart = { x: e.clientX, y: e.clientY };
      return;
    }

    const svgPos = this.screenToSVG(e.clientX, e.clientY);
    const dx = svgPos.x - this.dragStart.x;
    const dy = svgPos.y - this.dragStart.y;

    if (mode === 'marquee') {
      this.marqueeBox.update((prev) => (prev ? { ...prev, x2: svgPos.x, y2: svgPos.y } : null));
      // Determine selection
      const box = { x1: this.dragStart.x, y1: this.dragStart.y, x2: svgPos.x, y2: svgPos.y };
      const sMinX = Math.min(box.x1, box.x2);
      const sMaxX = Math.max(box.x1, box.x2);
      const sMinY = Math.min(box.y1, box.y2);
      const sMaxY = Math.max(box.y1, box.y2);

      const newSelection = this.components()
        .filter((comp) => {
          let x1 = -20,
            x2 = 20,
            y1 = -20,
            y2 = 20;
          if (comp.type === 'busbar') {
            x1 = 0;
            x2 = comp.length || 100;
            y1 = -5;
            y2 = 5;
          } else if (comp.type === 'line') {
            x1 = -5;
            x2 = 5;
            y1 = -(comp.length || 100) / 2;
            y2 = (comp.length || 100) / 2;
          }

          const corners = [
            rotatePoint(x1 * comp.scale, y1 * comp.scale, comp.rotation),
            rotatePoint(x2 * comp.scale, y1 * comp.scale, comp.rotation),
            rotatePoint(x2 * comp.scale, y2 * comp.scale, comp.rotation),
            rotatePoint(x1 * comp.scale, y2 * comp.scale, comp.rotation)
          ];
          const gX = corners.map((p) => p.x + comp.x);
          const gY = corners.map((p) => p.y + comp.y);
          return Math.min(...gX) >= sMinX && Math.max(...gX) <= sMaxX && Math.min(...gY) >= sMinY && Math.max(...gY) <= sMaxY;
        })
        .map((c) => c.id);

      if (e.shiftKey || e.metaKey || e.ctrlKey) {
        this.selectedIds.set(newSelection);
      } else {
        this.selectedIds.set(newSelection);
      }
      return;
    }

    if (this.selectedIds().length === 0 || mode === 'none') return;

    // --- SNAP CALCULATION PHASE ---
    let snapDx = 0;
    let snapDy = 0;
    let snapFound = false;

    // Only calculate snapping if we are moving a single *leader* (even if it has followers)
    // We check against the first selected item as the 'leader' for snapping context.
    if (this.selectedIds().length === 1 && mode === 'move') {
      const leaderId = this.selectedIds()[0];
      const leader = this.components().find((c) => c.id === leaderId);

      if (leader && this.groupStartPositions[leaderId]) {
        const start = this.groupStartPositions[leaderId];
        // Predicted position without snap
        let tx = start.x + dx;
        let ty = start.y + dy;

        // Copy the snapping logic here, but update `snapDx/Dy` instead of `c.x/y` directly
        // 1. Busbar Leader
        if (leader.type === 'busbar') {
          const rotRad = (leader.rotation * Math.PI) / 180;
          const len = leader.length || 100;
          const p1x = tx,
            p1y = ty;
          const p2x = tx + len * Math.cos(rotRad);
          const p2y = ty + len * Math.sin(rotRad);

          for (const other of this.components()) {
            if (this.groupStartPositions[other.id]) continue; // Don't snap to moving things
            if (other.type === 'busbar') continue;

            const otherPorts = this.getGlobalPorts(other);
            for (const op of otherPorts) {
              const distInfo = getDistanceFromLineSegment(op.x, op.y, p1x, p1y, p2x, p2y);
              if (distInfo.distance < SNAP_DIST) {
                snapDx = op.x - distInfo.x;
                snapDy = op.y - distInfo.y;
                this.snapIndicator.set({ x: op.x, y: op.y });
                snapFound = true;
                break;
              }
            }
            if (snapFound) break;
          }
        }
        // 2. Component Leader
        else {
          const myPorts = getLocalPorts(leader);
          for (const other of this.components()) {
            if (this.groupStartPositions[other.id]) continue;

            if (other.type === 'busbar') {
              const rotRad = (other.rotation * Math.PI) / 180;
              const bx1 = other.x,
                by1 = other.y;
              const bx2 = other.x + (other.length || 100) * Math.cos(rotRad);
              const by2 = other.y + (other.length || 100) * Math.sin(rotRad);

              for (const lp of myPorts) {
                const rotatedLP = rotatePoint(lp.x * leader.scale, lp.y * leader.scale, leader.rotation);
                const gX = tx + rotatedLP.x,
                  gY = ty + rotatedLP.y;
                const distInfo = getDistanceFromLineSegment(gX, gY, bx1, by1, bx2, by2);
                if (distInfo.distance < SNAP_DIST) {
                  snapDx = distInfo.x - gX;
                  snapDy = distInfo.y - gY;
                  this.snapIndicator.set({ x: distInfo.x, y: distInfo.y });
                  snapFound = true;
                  break;
                }
              }
            } else {
              // Port to Port
              const otherPorts = this.getGlobalPorts(other);
              for (const lp of myPorts) {
                const rotatedLP = rotatePoint(lp.x * leader.scale, lp.y * leader.scale, leader.rotation);
                const gX = tx + rotatedLP.x,
                  gY = ty + rotatedLP.y;
                for (const op of otherPorts) {
                  if (Math.hypot(gX - op.x, gY - op.y) < SNAP_DIST) {
                    snapDx = op.x - rotatedLP.x - tx;
                    snapDy = op.y - rotatedLP.y - ty;
                    this.snapIndicator.set({ x: op.x, y: op.y });
                    snapFound = true;
                    break;
                  }
                }
                if (snapFound) break;
              }
            }
            if (snapFound) break;
          }
        }
      }
    }

    if (!snapFound) this.snapIndicator.set(null);

    const finalDx = dx + snapDx;
    const finalDy = dy + snapDy;

    // --- APPLY PHASE ---
    this.components.update((prev) => {
      const nextBase = prev.map((c) => {
        if (this.groupStartPositions[c.id]) {
          // Apply Movement
          if (mode === 'move') {
            let tx = this.groupStartPositions[c.id].x + finalDx;
            let ty = this.groupStartPositions[c.id].y + finalDy;
            // Apply Grid Snap only if no magnetic snap happened
            if (!snapFound) {
              tx = Math.round(tx / 5) * 5;
              ty = Math.round(ty / 5) * 5;
            }
            return { ...c, x: tx, y: ty };
          }
        }

        // Resize/Label Logic (Handles single item usually, iterating 'c' is fine)
        if (mode === 'resize' && this.selectedIds().includes(c.id)) {
          if (c.type === 'busbar') {
            const newLen = Math.max(20, (this.itemStart.length || 0) + dx);
            return { ...c, length: newLen };
          }
          if (c.type === 'line') return { ...c, length: Math.max(20, (this.itemStart.length || 0) + dx) };
          return { ...c, scale: Math.max(0.1, Math.min(10, this.itemStart.scale + dy / 200)) };
        }

        if (mode === 'label' && this.selectedIds().includes(c.id)) {
          const lD = rotatePoint(dx, dy, -c.rotation);
          return { ...c, labelOffset: { x: this.itemStart.labelOffset.x + lD.x / c.scale, y: this.itemStart.labelOffset.y + lD.y / c.scale } };
        }

        return c;
      });
      return this.resolveConstraints(nextBase);
    });
  }

  handleMouseUp() {
    const mode = this.dragMode();
    if (mode === 'move' && this.snapIndicator() && this.selectedIds().length === 1) {
      const c = this.components().find((comp) => comp.id === this.selectedIds()[0])!;
      const myPorts = getLocalPorts(c);
      let found = false;
      const comps = this.components();

      for (const other of comps) {
        if (other.id === c.id) continue;
        const otherPorts = getLocalPorts(other).map((p) => ({ ...p, ...getGlobalPortPosition(other, p.id) }));
        for (const mp of myPorts) {
          const gMP = getGlobalPortPosition(c, mp.id);
          for (const op of otherPorts) {
            if (Math.hypot(gMP.x - op.x, gMP.y - op.y) < 2) {
              this.connections.update((prev) => [
                ...prev.filter((l) => !(l.sourceId === c.id && l.sourcePort === mp.id)),
                { sourceId: c.id, sourcePort: mp.id, targetId: other.id, targetPort: op.id }
              ]);
              found = true;
              break;
            }
          }
          if (found) break;
        }
        if (found) break;
      }
    }

    if (mode === 'move' || mode === 'resize' || mode === 'label') {
      const startState = mode === 'move' ? this.itemStart : this.itemStart.componentsAtStart;
      // Simple equality check is risky with objects, but works for basic history
      if (startState && JSON.stringify(startState) !== JSON.stringify(this.components())) {
        this.history.update((h) => [...h, startState]);
        this.future.set([]);
      }
    }

    this.dragMode.set('none');
    this.snapIndicator.set(null);
    this.marqueeBox.set(null);
  }

  handleWheel(e: WheelEvent) {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = -e.deltaY * 0.001;
      this.view.update((v) => ({ ...v, scale: Math.min(Math.max(0.1, v.scale + delta), 8) }));
    } else {
      this.view.update((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    }
  }

  handleDrop(e: DragEvent) {
    e.preventDefault();
    const type = e.dataTransfer?.getData('type') as ComponentType;
    if (!type) return;
    const pt = this.screenToSVG(e.clientX, e.clientY);
    const meta = COMPONENT_METADATA[type];
    const newComp: DiagramComponent = {
      id: `${type}-${Date.now()}`,
      type,
      x: Math.round(pt.x / 10) * 10,
      y: Math.round(pt.y / 10) * 10,
      rotation: 0,
      state: 'closed',
      label: meta.defaultLabel,
      labelOffset: { ...meta.defaultOffset },
      scale: 1,
      color: this.theme() === 'dark' ? '#f5f5f5' : '#171717',
      length: type === 'busbar' ? 400 : type === 'line' ? 100 : undefined
    };
    if (type === 'busbar') newComp.color = '#ffffff';

    this.commitToHistory([...this.components(), newComp]);
    this.selectedIds.set([newComp.id]);
  }

  onDragStart(e: DragEvent, type: string) {
    e.dataTransfer?.setData('type', type);
  }

  // --- UI Helpers ---

  toggleTheme() {
    this.theme.update((t) => (t === 'light' ? 'dark' : 'light'));
  }

  adjustZoom(delta: number) {
    this.view.update((v) => ({ ...v, scale: Math.min(8, Math.max(0.1, v.scale + delta)) }));
  }

  resetView() {
    this.view.set({ x: 0, y: 0, scale: 1 });
  }

  toggleGroup(name: string) {
    this.collapsedGroups.update((g) => ({ ...g, [name]: !g[name] }));
  }

  isGroupCollapsed(name: string) {
    return this.collapsedGroups()[name];
  }

  getComponentLabel(type: string) {
    return COMPONENT_METADATA[type as ComponentType].defaultLabel || type;
  }

  isSelected(id: string) {
    return this.selectedIds().includes(id);
  }

  rotateSelected() {
    const ids = this.selectedIds();
    if (ids.length === 0) return;
    const next = this.components().map((c) => (ids.includes(c.id) ? { ...c, rotation: (c.rotation + 90) % 360 } : c));
    this.commitToHistory(this.resolveConstraints(next));
  }

  deleteSelected() {
    const ids = this.selectedIds();
    if (ids.length === 0) return;
    const remaining = this.components().filter((c) => !ids.includes(c.id));
    this.commitToHistory(remaining);
    this.connections.update((prev) => prev.filter((l) => !ids.includes(l.sourceId) && !ids.includes(l.targetId)));
    this.selectedIds.set([]);
  }

  setBulkColor(color: string) {
    const ids = this.selectedIds();
    this.commitToHistory(this.components().map((c) => (ids.includes(c.id) ? { ...c, color } : c)));
  }

  // Input bindings
  updateLabel(val: string) {
    const id = this.selectedIds()[0];
    if (!id) return;
    const next = this.components().map((c) => (c.id === id ? { ...c, label: val } : c));
    this.commitToHistory(this.resolveConstraints(next));
  }

  updateScale(val: string) {
    const id = this.selectedIds()[0];
    if (!id) return;
    const next = this.components().map((c) => (c.id === id ? { ...c, scale: Math.max(0.1, parseFloat(val) || 0.1) } : c));
    this.components.set(this.resolveConstraints(next));
  }

  updateLength(val: number) {
    const id = this.selectedIds()[0];
    if (!id) return;
    const next = this.components().map((c) => (c.id === id ? { ...c, length: Math.max(10, val || 10) } : c));
    this.components.set(this.resolveConstraints(next));
  }

  // Template helpers
  abs = Math.abs;
  min = Math.min;
  round = Math.round;
}
