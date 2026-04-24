// ---------------------------------------------------------------------------
// Schelling Point board generator — deterministic map generation for focal-point games
// ---------------------------------------------------------------------------

export type CellType =
  | 'road'
  | 'bridge'
  | 'water'
  | 'school'
  | 'church'
  | 'gas_station'
  | 'parking_garage'
  | 'train_station'
  | 'park'
  | 'hospital'
  | 'library'
  | 'intersection'
  | 'empty';

export interface SchellingBoard {
  width: number;
  height: number;
  cells: CellType[][];
  seed: number;
}

// Simple seeded LCG PRNG for determinism
function createRng(seed: number) {
  let state = seed;
  return {
    next(): number {
      // LCG parameters from Numerical Recipes
      state = (state * 1664525 + 1013904223) & 0x7fffffff;
      return state / 0x7fffffff;
    },
    nextInt(min: number, max: number): number {
      return min + Math.floor(this.next() * (max - min + 1));
    },
  };
}

const LANDMARK_TYPES: CellType[] = [
  'school', 'church', 'hospital', 'library', 'train_station', 'gas_station', 'parking_garage',
];

export function generateBoard(width: number, height: number, seed: number): SchellingBoard {
  const rng = createRng(seed);

  // Initialize all cells as empty
  const cells: CellType[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => 'empty' as CellType),
  );

  const inBounds = (r: number, c: number) => r >= 0 && r < height && c >= 0 && c < width;
  const isType = (r: number, c: number, t: CellType) => inBounds(r, c) && cells[r][c] === t;

  // --- Place water clusters (2-3 clusters, 3-6 cells each via BFS flood-fill) ---
  const waterClusters = rng.nextInt(2, 3);
  for (let w = 0; w < waterClusters; w++) {
    const startR = rng.nextInt(1, height - 2);
    const startC = rng.nextInt(1, width - 2);
    const clusterSize = rng.nextInt(3, 6);
    const queue: [number, number][] = [[startR, startC]];
    let placed = 0;

    while (queue.length > 0 && placed < clusterSize) {
      const idx = rng.nextInt(0, queue.length - 1);
      const [r, c] = queue.splice(idx, 1)[0];
      if (!inBounds(r, c) || cells[r][c] !== 'empty') continue;

      cells[r][c] = 'water';
      placed++;

      // Add neighbors to queue
      const dirs: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      for (const [dr, dc] of dirs) {
        const nr = r + dr;
        const nc = c + dc;
        if (inBounds(nr, nc) && cells[nr][nc] === 'empty') {
          queue.push([nr, nc]);
        }
      }
    }
  }

  // --- Place road network: 2-3 horizontal + 2-3 vertical lines ---
  const hRoads: number[] = [];
  const vRoads: number[] = [];

  // Pick a row/col from [lo, hi] that's at least `minGap` away from every
  // value already in `taken`. If no such position exists, fall back to the
  // loosest non-taken value. Guards against an infinite retry loop when
  // the caller asks for more non-adjacent lines than the board can
  // physically fit — e.g., 3 horizontal roads in an 8-tall grid where
  // the first two can land sparsely enough that no third position
  // satisfies the `minGap=2` constraint.
  function pickNonAdjacent(lo: number, hi: number, taken: number[], minGap = 2): number {
    const free: number[] = [];
    for (let v = lo; v <= hi; v++) {
      if (taken.includes(v)) continue;
      if (taken.every((t) => Math.abs(t - v) >= minGap)) free.push(v);
    }
    if (free.length > 0) return free[Math.floor(rng.next() * free.length)];
    // Relaxed fallback: any value not already taken.
    const untaken: number[] = [];
    for (let v = lo; v <= hi; v++) {
      if (!taken.includes(v)) untaken.push(v);
    }
    if (untaken.length > 0) return untaken[Math.floor(rng.next() * untaken.length)];
    return lo;
  }

  const numH = rng.nextInt(2, 3);
  for (let i = 0; i < numH; i++) {
    const row = pickNonAdjacent(1, height - 2, hRoads);
    hRoads.push(row);
    for (let c = 0; c < width; c++) {
      if (cells[row][c] === 'empty') {
        cells[row][c] = 'road';
      }
    }
  }

  const numV = rng.nextInt(2, 3);
  for (let i = 0; i < numV; i++) {
    const col = pickNonAdjacent(1, width - 2, vRoads);
    vRoads.push(col);
    for (let r = 0; r < height; r++) {
      if (cells[r][col] === 'empty') {
        cells[r][col] = 'road';
      } else if (cells[r][col] === 'road') {
        // Road crossing — mark as intersection
        cells[r][col] = 'intersection';
      }
    }
  }

  // --- Place bridges where roads are adjacent to water ---
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      if (cells[r][c] !== 'road') continue;
      const dirs: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      const adjacentToWater = dirs.some(([dr, dc]) => isType(r + dr, c + dc, 'water'));
      if (adjacentToWater) {
        cells[r][c] = 'bridge';
      }
    }
  }

  // --- Place landmarks on or adjacent to roads, min spacing 3 ---
  const landmarkPositions: [number, number][] = [];

  const isOnOrAdjacentToRoad = (r: number, c: number): boolean => {
    const roadTypes: CellType[] = ['road', 'intersection', 'bridge'];
    if (roadTypes.includes(cells[r][c])) return true;
    const dirs: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    return dirs.some(([dr, dc]) => inBounds(r + dr, c + dc) && roadTypes.includes(cells[r + dr][c + dc]));
  };

  const hasMinSpacing = (r: number, c: number): boolean => {
    return landmarkPositions.every(
      ([lr, lc]) => Math.abs(r - lr) + Math.abs(c - lc) >= 3,
    );
  };

  for (const landmarkType of LANDMARK_TYPES) {
    // Collect candidate positions
    const candidates: [number, number][] = [];
    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        if (cells[r][c] === 'empty' && isOnOrAdjacentToRoad(r, c) && hasMinSpacing(r, c)) {
          candidates.push([r, c]);
        }
      }
    }

    if (candidates.length > 0) {
      const [r, c] = candidates[rng.nextInt(0, candidates.length - 1)];
      cells[r][c] = landmarkType;
      landmarkPositions.push([r, c]);
    }
  }

  // --- Scatter park clusters (2-3 clusters, 2-4 cells each) ---
  const parkClusters = rng.nextInt(2, 3);
  for (let p = 0; p < parkClusters; p++) {
    const startR = rng.nextInt(0, height - 1);
    const startC = rng.nextInt(0, width - 1);
    const clusterSize = rng.nextInt(2, 4);
    const queue: [number, number][] = [[startR, startC]];
    let placed = 0;

    while (queue.length > 0 && placed < clusterSize) {
      const idx = rng.nextInt(0, queue.length - 1);
      const [r, c] = queue.splice(idx, 1)[0];
      if (!inBounds(r, c) || cells[r][c] !== 'empty') continue;

      cells[r][c] = 'park';
      placed++;

      const dirs: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      for (const [dr, dc] of dirs) {
        const nr = r + dr;
        const nc = c + dc;
        if (inBounds(nr, nc) && cells[nr][nc] === 'empty') {
          queue.push([nr, nc]);
        }
      }
    }
  }

  return { width, height, cells, seed };
}

// Cell type → single character for text representation
const CELL_CHARS: Record<CellType, string> = {
  empty: '.',
  road: '─',
  intersection: '╋',
  bridge: '═',
  water: '~',
  park: '♣',
  school: 'S',
  church: 'C',
  hospital: 'H',
  library: 'L',
  train_station: 'T',
  gas_station: 'G',
  parking_garage: 'P',
};

export function boardToText(board: SchellingBoard): string {
  const lines: string[] = [];

  // Column labels
  const colLabels = '   ' + Array.from({ length: board.width }, (_, i) => String(i).padStart(2)).join('');
  lines.push(colLabels);

  for (let r = 0; r < board.height; r++) {
    const rowLabel = String(r).padStart(2) + ' ';
    const rowCells = board.cells[r].map(cell => ' ' + CELL_CHARS[cell]).join('');
    lines.push(rowLabel + rowCells);
  }

  lines.push('');
  lines.push('Legend: . empty  ─ road  ╋ intersection  ═ bridge  ~ water  ♣ park');
  lines.push('        S school  C church  H hospital  L library  T train_station');
  lines.push('        G gas_station  P parking_garage');

  return lines.join('\n');
}
