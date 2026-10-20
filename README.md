# Walking reach in central Weimar

A 3D map of central Weimar that shows how far you can walk in 5, 10 and 15 minutes from any point, how many buildings that reaches, and about how many people live there.

Buildings stand at their measured height and are coloured by their main use. Click on the ground (or on a roof) and the app walks the pedestrian network from the nearest junction. It draws three nested areas in shades of orange, highlights the buildings that touch each area in the same shade, and lists the counts in a panel.

## Run it

```
npm install     install the packages
npm run dev     start the app at http://localhost:5173
npm run build   build the site into dist/, as GitHub Pages does
```

On every push to `main`, GitHub Pages publishes the app at `https://<user>.github.io/<repo>/` through `.github/workflows/deploy.yml`.

Mouse: drag to orbit, right-drag to pan, scroll to zoom. A short click without dragging picks a starting point.

## Method

- **Start.** The app takes the street junction or dead end of the pedestrian network nearest to your click. If no walkable street is within 100 m, it says so and draws nothing. The walk from your click to that junction isn't counted.
- **Walking.** It follows the walkable edges of `streets.graph.json` by their `length` in metres at 4.8 km/h, which is 80 m per minute: 400 m in 5 minutes, 800 m in 10 and 1,200 m in 15. Streets can be walked both ways.
- **Areas.** Each area is the set of street segments reached in that time, including the reachable part of the last segment, with a band of 25 m on each side, joined into one shape. It isn't a circle or a convex hull, so courtyards and blocks far from any reached street stay out.
- **Buildings.** A building counts when its footprint touches the area, meaning it comes within 25 m of a reached street. Each building gets the shade of the nearest area it touches.
- **Residents.** Every Zensus 2022 100 m cell that overlaps the area adds its population times the share of the cell's area that lies inside. The total is rounded to the nearest 10.
- **Cells without a figure.** Cells whose `population` is `null` have no published resident count. They aren't treated as zero: they are left out of the sum, and the panel shows how many of them overlap the area.

## Limits

- Walking speed is one fixed 4.8 km/h for everyone. Slopes, steps, crossings and waiting at traffic lights aren't included.
- The 25 m band is a simple stand-in for "the buildings along a street". A tall building set back more than 25 m from every reached street isn't counted, even if its entrance is close.
- The resident count assumes people are spread evenly across each 100 m cell, which they aren't: they live in the buildings. The census also changes small counts slightly at random to protect privacy. Read the figure as an estimate, which is why it's rounded to 10.
- Cells without a published figure are left out, so the true number may be somewhat higher where such cells overlap.
- The data covers only the kit area, about 1.3 × 2 km. Near its edges the network stops, and areas end at the border.
- One building (id 17520) has no `use` in the data. It's drawn in near-white as "no use given".

## Data sources

All data is in `public/data/`; see `public/data/SOURCES.md`. The app fetches nothing from the internet.

| File | Source | Licence |
| --- | --- | --- |
| `buildings.geojson` | footprints and heights: 3D building models LoD2 of Thuringia, © GDI-Th; uses: Egor Gaydukov | dl-de/by-2-0 |
| `streets.graph.json` | pedestrian network: Egor Gaydukov, InfAU, Bauhaus-Universität Weimar | |
| `zensus.geojson` | Zensus 2022, 100 m grid, © Statistische Ämter des Bundes und der Länder | dl-de/by-2-0 |
| `kit.json` | the kit generator | |

Buildings: 3D building models LoD2 © GDI-Th (dl-de/by-2-0). Land use and pedestrian network: Egor Gaydukov, InfAU, Bauhaus-Universität Weimar. Census grid: Zensus 2022, © Statistische Ämter des Bundes und der Länder (dl-de/by-2-0).

## How this was made

1. Tools: Claude Code, with the model Claude Opus 5.5 (`claude-opus-5-5`).
2. I decided:
3. The agent did: it read the data kit, then wrote and tested the walking, band and resident calculation and the React Three Fiber map with its panel, legend and attribution, checking the result in a headless browser.
4. I checked:
