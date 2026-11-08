import { useId, useState } from "react";
import { Calendar, MapPin, Plane, Search } from "lucide-react";
import { destinations, validateDates, type Destination } from "@/data/destinations";
import { highlightParts, searchDestinations } from "@/lib/destination-search";

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

  const [active, setActive] = useState(0);
  const listId = useId();
  const hits = searchDestinations(destinations, query);
  const exact = hits[0] && hits[0].score >= 95 ? hits[0].destination : null;

  function choose(d: Destination) {
    setSelected(d);
    setQuery(d.name);
    setOpen(false);
    setError(null);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) return setOpen(true);
      if (hits.length) setActive((i) => (i + (e.key === "ArrowDown" ? 1 : hits.length - 1)) % hits.length);
    } else if (e.key === "Enter" && open && hits[active]) {
      e.preventDefault(); // pick the highlighted country instead of submitting the form
      choose(hits[active].destination);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const dest = selected ?? exact; // a fully typed name counts even if it wasn't clicked
    if (!dest) return setError("Choose a destination from the list.");
    const err = validateDates(depart, ret);
    if (err) return setError(err);
    setError(null);
    if (!selected) choose(dest);
    onSubmit({ destination: dest, depart, ret });
  }

  return (
    <div className={`overlay-fade pointer-events-none absolute inset-0 flex flex-col items-center justify-end px-4 pb-10 md:justify-center md:pb-0 ${hidden ? "is-hidden" : ""}`}>
      <div className="search-platform pointer-events-auto w-full max-w-5xl rounded-3xl px-5 py-7 md:px-8 md:py-9">
      <div className="mb-6 text-center">
        <h1 className="font-display text-4xl font-semibold tracking-tight text-foreground md:text-6xl">Go places. Know before you go.</h1>
        <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground md:text-base">
          Destination-specific health advisories, seasonal risks and a packing list — matched to your travel dates.
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
                  onChange={(e) => { setQuery(e.target.value); setSelected(null); setActive(0); setOpen(true); }}
                  onFocus={() => setOpen(true)}
                  onBlur={() => setTimeout(() => { setOpen(false); if (!selected && exact) choose(exact); }, 150)}
                  onKeyDown={onKeyDown}
                  placeholder="Where to? Type a country"
                  className="field-input"
                  role="combobox"
                  aria-expanded={open && query.trim().length > 0}
                  aria-controls={listId}
                  aria-autocomplete="list"
                  aria-activedescendant={open && hits[active] ? `${listId}-${hits[active].destination.id}` : undefined}
                  aria-label="Destination"
                  autoComplete="off"
                  spellCheck={false}
                />
              </span>
            </label>
            {open && query.trim().length > 0 && (
              <ul id={listId} className="glass-solid absolute z-10 mt-2 max-h-80 w-full overflow-y-auto rounded-2xl py-1" role="listbox">
                {hits.length === 0 && (
                  <li className="px-4 py-3 text-sm text-muted-foreground">
                    No match for “{query.trim()}”. We list the {destinations.length} countries with current surveillance data.
                  </li>
                )}
                {hits.map((h, i) => {
                  const parts = highlightParts(h.destination.name, query);
                  return (
                    <li key={h.destination.id} id={`${listId}-${h.destination.id}`} role="option" aria-selected={i === active}>
                      <button
                        type="button"
                        tabIndex={-1}
                        onMouseDown={() => choose(h.destination)}
                        onMouseEnter={() => setActive(i)}
                        className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm ${i === active ? "bg-secondary" : ""}`}
                      >
                        <span className="min-w-0">
                          <span className="font-medium">
                            {parts ? <>{parts[0]}<mark className="bg-transparent text-accent">{parts[1]}</mark>{parts[2]}</> : h.destination.name}
                          </span>
                          {h.matchedAlias && <span className="ml-2 text-xs text-muted-foreground">({h.matchedAlias})</span>}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">{h.destination.region}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <label className="field">
            <Calendar className="size-4 text-accent" />
            <span className="flex-1">
              <span className="field-label">Departure</span>
              <input type="date" value={depart} onChange={(e) => setDepart(e.target.value)} className="field-input" aria-label="Departure date" />
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
      <p className="mt-4 text-center text-xs text-muted-foreground">Live surveillance data for {destinations.length} destinations</p>
      </div>
    </div>
  );
}
