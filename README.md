# AI in Design: start repo

A bare web app, a city kit of open data, and a starter prompt. GitHub Pages publishes the app on every push.

## Make your own copy

In the folder where you keep projects:

```
gh repo create city-reach --template Bauhaus-InfAU/ai-in-design --public --clone
cd city-reach
code .
```

Then turn on publishing: on GitHub, open your repo, Settings, Pages, and set Source to "GitHub Actions". After your next push the site is at `https://<your-username>.github.io/city-reach/`.

## Run it

```
npm install     install the packages
npm run dev     start the app at http://localhost:5173
```

The start page says "Nothing here yet" and names the city kit.

## What's in here

| Path | What it is |
| --- | --- |
| `CLAUDE.md` | what the agent reads first every time it starts. Short on purpose: you add to it |
| `prompt.md` | the starter prompt |
| `public/data/` | the city kit: central Weimar, about 1.3 × 2 km. `SOURCES.md` there lists every file, its source, licence and fields |
| `src/` | the app; for now only a start page |
| `.github/workflows/` | builds the app and publishes it to GitHub Pages on every push to `main` |

## Data and credit

Buildings: 3D building models LoD2 © GDI-Th (dl-de/by-2-0). Land use and pedestrian network: Egor Gaydukov, InfAU, Bauhaus-Universität Weimar. Census grid: Zensus 2022, © Statistische Ämter des Bundes und der Länder (dl-de/by-2-0). Any page that shows the data carries this line.
