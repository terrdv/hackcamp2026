<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

## What Lovable manages

Rules outside this block are the project's own. Change the pieces below in
Lovable, not by hand. With the [Lovable MCP](https://mcp.lovable.dev)
connected, `send_message` asks Lovable to do it; otherwise ask the user to
use the editor.

- **Database.** Do not add or edit `supabase/migrations/` or `drizzle/`.
  Ask Lovable to change the schema.
- **Generated files.** Do not edit a file whose header says it is automatically
  generated.
- **AI gateway.** Keep model calls on Lovable's gateway, and keep
  `LOVABLE_API_KEY` out of browser code.
- **Connectors.** Lovable provides native connectors. `list_connectors` shows
  which are enabled; `add_connector` only returns the dashboard link. When a
  connector is enabled, calls go through the connector gateway and need
  `LOVABLE_API_KEY`. When Lovable does not provide one, users can bring their
  own key and store it in Secrets.
- **Secrets.** Lovable manages them. Do not put secret values in the repo.
<!-- LOVABLE:END -->

- Render the textured globe with geographically aligned raster imagery so country overlays remain registered to land.
- Display only the Original MapLibre satellite renderer on the homepage, without an in-page style switch. Keep the unused GLB renderer separate from it.
- Register GLB overlays through barycentric UV-to-surface projection because the model's geographic textures are warped relative to ideal spherical XYZ coordinates.
- Flatten GLB radial relief before building its surface projector, and derive glass Earth maps and destination outlines from the same Natural Earth 10m source to preserve coastline registration.
- Apply the enlarged clipped canvas and lowered camera padding only in search/reset views; restore the full-viewport canvas before destination fly-to to preserve its framing and interaction.
- Render glass Earth atmosphere using bounded pixel-ray altitude scattering on two disposable additive shells, with an opaque depth-writing Earth occluding the far side; avoid full-screen bloom targets.
- Apply land and ocean gradients in the physical material shader using geographic UV-anchored spherical value noise, preserving lighting and existing high-resolution detail maps.
