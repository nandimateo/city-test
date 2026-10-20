# Sources

The city kit: central Weimar, about 1278 × 1983 m, west of and including the Markt. Generated on 2026-10-13 from data prepared for an earlier course; the scripts are on the `city-kit` branch of Bauhaus-InfAU/ai-in-design. Don't edit these files by hand.

Bounding box, west, south, east, north: 11.315255, 50.973934, 11.334340, 50.991391. All coordinates are WGS84 longitude and latitude, longitude first.

| File | Source | Licence |
| --- | --- | --- |
| `buildings.geojson` | footprints and heights: 3D building models LoD2 of Thuringia; uses: Egor Gaydukov | dl-de/by-2-0 |
| `plots.geojson` | land use per plot: Egor Gaydukov | |
| `streets.geojson`, `streets.graph.json` | pedestrian network: Egor Gaydukov | |
| `zensus.geojson` | Zensus 2022, 100 m grid | dl-de/by-2-0 |
| `kit.json` | the generator | |

## Attribution

Put this line on every map or page that uses the kit:

> Buildings: 3D building models LoD2 © GDI-Th (dl-de/by-2-0). Land use and pedestrian network: Egor Gaydukov, InfAU, Bauhaus-Universität Weimar. Census grid: Zensus 2022, © Statistische Ämter des Bundes und der Länder (dl-de/by-2-0).

## `buildings.geojson`

Footprints and heights from the 3D building models in level of detail 2 (LoD2) of the Thüringer Landesamt für Bodenmanagement und Geoinformation, tiles 32_662_5648 and 32_662_5650, surveyed 14 October 2024. Licence: Datenlizenz Deutschland, Namensnennung, Version 2.0 (dl-de/by-2-0), © GDI-Th. Floors and floor area by use were added by Egor Gaydukov.

4316 buildings. Every building has a height.

| Field | Meaning | Unit |
| --- | --- | --- |
| `id` | building id | |
| `height` | height of the building, from the ground to the highest point of the roof | metres |
| `height_source` | always `lod2`: measured in the 3D building model | |
| `floors` | floors above ground | floors |
| `use` | the use with the largest floor area in the building | |
| `floor_area_m2` | floor area per use, only uses above zero | m² |

The uses are `residential`, `service`, `undefined`, `education`, `civic`, `entertainment`, `retail`, `food_and_drink`, `office`, `health`, `accommodation`, `culture`, `sport`, `transport`, `light_industrial`. `undefined` is floor area whose use is not known. Floor areas are estimates for the whole building, not surveyed per floor.

## `plots.geojson`

Plots with their land use, prepared by Egor Gaydukov. 2750 plots.

| `landuse` | Plots |
| --- | --- |
| `residential` | 2171 |
| `mixed use` | 216 |
| `special functions` | 169 |
| `industrial and commercial` | 83 |
| `recreation` | 56 |
| `square` | 33 |
| `flowing water` | 16 |
| `wasteland` | 3 |
| `cemetery` | 2 |
| `standing water` | 1 |

## `streets.geojson` and `streets.graph.json`

A pedestrian network drawn by Egor Gaydukov for a walking simulation. It follows streets, paths and squares, and crosses squares where people walk across them. Every edge is walkable.

`streets.geojson` is the drawing: one straight line per edge, with `length` and `walkable`.

`streets.graph.json` is the network, for routing:

- `nodes`: `id`, `lon`, `lat`. A node is a junction or a dead end.
- `edges`: `id`, `from` and `to` (node ids), `length` in metres, `walkable`, and `coords`, the line from `from` to `to`.

Edges have no direction; you can walk them both ways. 962 nodes, 1186 edges, 46.4 km in total, all in one connected network.

## `zensus.geojson`

The Zensus 2022 census on a 100 m grid, reference date 15 May 2022. Source: Statistische Ämter des Bundes und der Länder, https://www.zensus2022.de, files from https://www.zensus2022.de/DE/Ergebnisse-des-Zensus/gitterzellen.html. Licence: Datenlizenz Deutschland, Namensnennung, Version 2.0 (dl-de/by-2-0, https://www.govdata.de/dl-de/by-2-0).

245 cells, kept whole wherever a cell touches the kit area. Each cell is a 100 m square in the European grid (EPSG:3035), stored here as a polygon in longitude and latitude.

| Field | Meaning | Unit |
| --- | --- | --- |
| `id` | the census grid id of the cell | |
| `population` | residents | persons |
| `avg_age` | average age of the residents | years |
| `rent_eur_m2` | average net rent without heating and service charges (Nettokaltmiete) | € per m² per month |
| `vacancy_pct` | share of flats standing empty | percent |
| `heating_main` | the most common main heating type of the residential buildings in the cell; ties are joined with " / " | |
| `heating_buildings` | residential buildings counted for `heating_main` | buildings |
| `uncertain` | fields the census marks as statistically unreliable, because they rest on very few cases | |

How to read it:

- A cell is an area, not a building. To share a cell's residents out, use the part of the cell's area that you need.
- `null` means the census published no figure for that field in that cell. A cell with `population: null` is in the kit because another table lists it, for example because it has flats or residential buildings, but the census published no resident count for it. Don't read `null` as zero. Leave such cells out of sums and say how many you left out.
- The census protects privacy by changing small counts slightly at random (the cell-key method). Single cells are therefore approximate, and cell values don't add up exactly to official totals.
- In the source tables, "–" means exactly zero or set to zero. The kit stores it as `0`.

244 of the 245 cells have a resident count, 21781 residents in total. 227 cells have a rent figure.

## `kit.json`

The kit area: `label`, `center` as `[lon, lat]`, `bbox` as `[west, south, east, north]`, `size_m` as `[width, height]`, and `generated`.
