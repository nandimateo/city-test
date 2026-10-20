# Project guidelines

I study architecture or design and don't write code. Explain each step in a sentence or two of plain words. After a change, say which files you changed and what I should check on the page.

## Stack

Vite, React in JavaScript, npm. Three.js / React Three Fiber for 3D, MapLibre GL JS for maps. Don't add TypeScript or switch frameworks.

## Hosting

GitHub Pages publishes every push to `main` at `https://<user>.github.io/<repo>/`, through the workflow in `.github/workflows/`. Load every data file through `import.meta.env.BASE_URL`: a path that starts with `/data/` works on localhost and breaks on Pages.

## Data

The city kit is in `public/data/`. Read `SOURCES.md` there before you use it.
