import { PRESETS, Preset } from "../lib/dates";

type Range = { from: string; to: string };

type Props = {
  range: Range;
  preset: Preset | null;
  onPreset: (p: Preset) => void;
  onCustom: (r: Range) => void;
};

export function RangePicker({ range, preset, onPreset, onCustom }: Props) {
  return (
    <div className="range-picker panel">
      <div className="chips" role="group" aria-label="Periodo">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            className={`chip${preset === p.id ? " active" : ""}`}
            aria-pressed={preset === p.id}
            onClick={() => onPreset(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="date-inputs">
        <label>
          Desde
          <input type="date" value={range.from} max={range.to} onChange={(e) => onCustom({ ...range, from: e.target.value })} />
        </label>
        <label>
          Hasta
          <input type="date" value={range.to} min={range.from} onChange={(e) => onCustom({ ...range, to: e.target.value })} />
        </label>
      </div>
    </div>
  );
}
