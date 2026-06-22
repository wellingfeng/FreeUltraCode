import { Handle, Position } from '@xyflow/react';
import type { CSSProperties } from 'react';

/**
 * Shared handle primitives for the blueprint nodes.
 *
 * Two pin kinds, matching the IR / design doc:
 *   - exec (▶): execution flow — rendered as a triangle.
 *   - data (●): data flow — rendered as a circle.
 *
 * Handle ids follow the IR port convention (`exec_in`, `exec_out`,
 * `data_in`, `data_out`) so edges from {@link irToFlow} attach correctly.
 */

/** Triangle (exec) styling — a right-pointing ▶ drawn with a CSS border trick. */
const execStyle: CSSProperties = {
  width: 0,
  height: 0,
  background: 'transparent',
  border: 'none',
  borderTop: '7px solid transparent',
  borderBottom: '7px solid transparent',
  borderLeft: '11px solid var(--pin-exec)',
  borderRadius: 0,
  filter: 'drop-shadow(0 0 3px var(--pin-glow-exec))',
  transition: 'filter 120ms ease, transform 120ms ease',
};

/** Circle (data) styling — a glass-filled ring dot that reads on any surface. */
const dataStyle: CSSProperties = {
  width: 12,
  height: 12,
  minWidth: 12,
  minHeight: 12,
  background: 'var(--node-glass-solid)',
  border: '2px solid var(--pin-data)',
  borderRadius: '50%',
  boxShadow: '0 0 0 1px var(--node-glass-solid), 0 0 4px var(--pin-glow-data)',
  transition: 'box-shadow 120ms ease, transform 120ms ease',
};

export interface PinProps {
  /** React Flow handle id; must match the IR port id. */
  id: string;
  /** Vertical offset (px) from the top of the node for stacked pins. */
  top?: number;
}

/** Execution input pin (left edge, triangle). */
export function ExecIn({ id, top }: PinProps) {
  return (
    <Handle
      type="target"
      position={Position.Left}
      id={id}
      className="ugs-pin-exec"
      style={{ ...execStyle, top, left: -6 }}
    />
  );
}

/** Execution output pin (right edge, triangle). */
export function ExecOut({ id, top }: PinProps) {
  return (
    <Handle
      type="source"
      position={Position.Right}
      id={id}
      className="ugs-pin-exec"
      style={{ ...execStyle, top, right: -6 }}
    />
  );
}

/** Data input pin (left edge, circle). */
export function DataIn({ id, top }: PinProps) {
  return (
    <Handle
      type="target"
      position={Position.Left}
      id={id}
      className="ugs-pin-data"
      style={{ ...dataStyle, top, left: -6 }}
    />
  );
}

/** Data output pin (right edge, circle). */
export function DataOut({ id, top }: PinProps) {
  return (
    <Handle
      type="source"
      position={Position.Right}
      id={id}
      className="ugs-pin-data"
      style={{ ...dataStyle, top, right: -6 }}
    />
  );
}
