import { useState } from "react";
import { Calendar, MapPin, Plane, Search } from "lucide-react";
import { destinations, validateDates, type Destination } from "@/data/destinations";

export interface SearchValues {
  destination: Destination;
  depart: string;
  ret: string;
}

export function SearchForm({ onSubmit, hidden }: { onSubmit: (v: SearchValues) => void; hidden: boolean }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Destination | null>(null);
  const [open, setOpen] = useState(false);
  const [depart, setDepart] = useState("");
  const [ret, setRet] = useState("");
  const [error, setError] = useState<string | null>(null);
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const matches = destinations.filter((d) => d.name.toLowerCase().includes(query.toLowerCase()));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return setError("Choose a destination from the list.");
    const err = validateDates(depart, ret);
    if (err) return setError(err);
    setError(null);
    onSubmit({ destination: selected, depart, ret });
  }

  return (
    <div className={`overlay-fade pointer-events-none absolute inset-0 flex flex-col items-center justify-end px-4 pb-10 md:justify-center md:pb-0 ${hidden ? "is-hidden" : ""}`}>
      <div className="search-platform pointer-events-auto w-full max-w-5xl rounded-3xl px-5 py-7 md:px-8 md:py-9">
      <div className="mb-6 text-center">
        <h1 className="font-display text-4xl font-semibold tracking-tight text-foreground md:text-6xl">Know before you go.</h1>
        <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground md:text-base">
          Explore destination-specific disease outbreaks, seasonal health risks, and practical precautions before your trip.
        </p>
      </div>
      <form onSubmit={submit} className="w-full">
        <div className="grid gap-2 md:grid-cols-[1.4fr_1fr_1fr_auto]">
          <div className="relative">
            <label className="field">
              <MapPin className="size-4 text-accent" />
              <span className="flex-1">
                <span className="field-label">Destination</span>
                <input
                  value={query}
                  onChange={(e) => { setQuery(e.target.value); setSelected(null); setOpen(true); }}
                  onFocus={() => setOpen(true)}
                  onBlur={() => setTimeout(() => setOpen(false), 150)}
                  placeholder="Where to?"
                  className="field-input"
                  role="combobox"
                  aria-expanded={open}
                  aria-label="Destination"
                />
              </span>
            </label>
            {open && (
              <ul className="glass-solid absolute z-10 mt-2 w-full overflow-hidden rounded-2xl py-1" role="listbox">
                {matches.length === 0 && <li className="px-4 py-3 text-sm text-muted-foreground">No mock data for that destination yet</li>}
                {matches.map((d) => (
                  <li key={d.id} role="option" aria-selected={selected?.id === d.id}>
                    <button type="button" onMouseDown={() => { setSelected(d); setQuery(d.name); setOpen(false); }} className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-secondary">
                      <span className="font-medium">{d.name}</span>
                      <span className="text-xs text-muted-foreground">{d.region}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <label className="field">
            <Calendar className="size-4 text-accent" />
            <span className="flex-1">
              <span className="field-label">Departure</span>
              <input type="date" value={depart} min={today} onChange={(e) => setDepart(e.target.value)} className="field-input" aria-label="Departure date" />
            </span>
          </label>
          <label className="field">
            <Plane className="size-4 text-accent" />
            <span className="flex-1">
              <span className="field-label">Return</span>
              <input type="date" value={ret} min={depart || undefined} onChange={(e) => setRet(e.target.value)} className="field-input" aria-label="Return date" />
            </span>
          </label>
          <button type="submit" className="btn-primary">
            <Search className="size-4" /> Explore destination
          </button>
        </div>
        {error && <p className="px-3 pt-2 text-sm text-destructive" role="alert">{error}</p>}
      </form>
      </div>
    </div>
  );
}
