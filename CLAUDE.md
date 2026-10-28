# Project guidelines

I study architecture or design and don't write code. Explain each step in a sentence or two of plain words. After a change, say which files you changed and what I should check on the page.

## Stack

Vite, React in JavaScript, npm. Three.js / React Three Fiber for 3D, MapLibre GL JS for maps. Don't add TypeScript or switch frameworks.

## Hosting

GitHub Pages publishes every push to `main` at `https://<user>.github.io/<repo>/`, through the workflow in `.github/workflows/`. Load every data file through `import.meta.env.BASE_URL`: a path that starts with `/data/` works on localhost and breaks on Pages.

## Data

The city kit is in `public/data/`. Read `SOURCES.md` there before you use it.

## Rhino and Grasshopper

You work in Rhino and Grasshopper through the Rhino MCP.

- Rhino and my app share coordinates. Before you bring data into Rhino, read how my app turns longitude and latitude into metres, and use the same conversion and origin.
- Write Grasshopper logic in Python 3 Script components, as plain scripts whose outputs are variables, not as classes. Give every input a type hint (Curve, Point3d, float, int).
- Read geometry I draw in Rhino through a Geometry Pipeline, filtered by layer and by type.
- One job per script. Split a large script into separate components that pass geometry to each other, for example buildings, trees and details.
- Show results as Grasshopper previews, with a Custom Preview and a colour swatch per output. Don't bake unless I ask.
- Closed solids face outwards, with their faces split at the corners.
- Details sit a few centimetres in front of the surface they belong to, and flat surfaces a few centimetres above the one below, so nothing flickers.
- If a call to Rhino or Grasshopper hangs, stop and tell me: a dialog is probably open. Don't retry.
- To put the design in my app: export what Grasshopper shows, in its colours, as one `.glb` file in `public/data/`, in the app's coordinates, and load it in the app's 3D scene. Rhino's glTF export keeps only render materials and drops transparency, so give each colour a render material and restore transparency in the app.

## Keys

- Keys live in `.env` and nowhere else: not in code, not in a commit, never in a variable starting with `VITE_`.
- Anything that needs a key runs as a Node script on my laptop, not in the page.
