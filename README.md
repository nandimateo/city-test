# Haussmann's Renovation of Weimar

A 3D map of central Weimar where a council keeps rebuilding the city by itself. Every round, a resident asks for a shorter route from their home to a building they need. Three urban planners each design that route. The people vote, and the winning design is built: the buildings in its way are demolished. Then the next round begins.

You can also click on the ground to see how far you can walk in 5, 10 and 15 minutes from any point, on the streets as the council leaves them.

## The idea

- **What it notices:** the city as it is now. That means which buildings still stand, their use and height, about how many people live in each (from the census), and how much longer a trip is by street than in a straight line. It also notices what the council decided in earlier rounds: what was demolished and how the votes went.
- **When it thinks:** by itself. A round starts 10 seconds after the last one ended, until you press Pause.
- **What it does:** a resident picks a destination and complains about the detour. Each planner picks one design and pitches it. The people vote for one design or reject all three. The app then demolishes the winning design's buildings and lays the new route. You can't undo it; only reloading the page brings the city back.

## Run it

```
npm install     install the packages
npm run dev     start the app at http://localhost:5173, with the council
npm run build   build the site into dist/, as GitHub Pages does
```

The council needs Claude Code on your laptop, signed in. The app calls it with `claude -p`, so it uses your own Claude account and needs no key.

On every push to `main`, GitHub Pages publishes the app at `https://<user>.github.io/<repo>/` through `.github/workflows/deploy.yml`. **The council only thinks on localhost.** The live page shows a note instead, and the walking reach works as before.

Mouse: drag to orbit, right-drag to pan, scroll to zoom. A short click without dragging picks a starting point for the walking reach. The camera glides to each new round on its own; you can orbit away at any time.

## How the council thinks

The app works out the facts. Claude only chooses between options the app lists, and gives a reason with every choice.

1. **The resident.** The app picks a random residential building that still stands and where someone lives. It offers up to eight non-residential buildings 300 to 1,200 m away in a straight line, the worst detours by street first, at most two of each use. Claude, speaking as the resident, picks one, invents a name and an age, and writes a complaint.
2. **The planners.** For three kinds of route in three widths (12, 20 and 32 m), the app works out the buildings the route would demolish, the homes and public buildings among them, the residents displaced, and how long the trip takes before and after. Each planner owns one kind of route and only chooses its width, a title and a pitch:
   - **The Prefect** cuts straight from door to door.
   - **The Engineer** widens the existing streets.
   - **The Conservator** bends the route around the bend point that demolishes the fewest buildings.

   All three think at the same time, and their designs are drawn on the map in their colours, with the buildings each would demolish.
3. **The vote.** Claude, speaking as the people of Weimar, sees the complaint, the three designs with their numbers and pitches, and the last rounds. It votes for one design or for none of them, gives the shares in percent and reports why.
4. **Building it.** The winner's buildings go one after another along the route, starting at the resident's home: a flash, a cloud of dust and flying debris, and the building collapses to rubble. A new route joins the walking network between the junctions nearest the two buildings; widened streets keep their network.

The log on the right shows every step: what the app noticed, what each voice decided and why, the vote, and what came down.

**What goes to Claude, and how often.** One round is five calls: the resident, three planners at once, and the vote. Each call sends only plain data: uses, heights, distances, minutes, counts, the earlier answers and a summary of the last four rounds. Each call takes about 4–7 seconds, so a round takes about 15–20 seconds of thinking. With a 10-second rest, a new round starts about every 30 seconds: roughly ten calls a minute while the council runs, and none while it's paused.

**How it is connected.** `server/council.js` adds an endpoint, `POST /api/council`, to the Vite dev server. It runs:

```
claude -p <prompt> --safe-mode --tools "" --model haiku --effort low --output-format json --no-session-persistence --system-prompt <voice> --json-schema <choices>
```

- `--tools ""` gives Claude no tools, so nothing sent from the page can make it read files or run commands.
- `--safe-mode` leaves out this project's settings, so an answer comes fast.
- The schema lists only the ids, widths and planners the app offered, so every answer can be carried out.

The voices' system prompts live in that file. They are the design: change them, and the city changes.

## Method

- **Residents per building.** Each Zensus 2022 cell's population is shared over the residential buildings whose centre lies in the cell, by volume (footprint × height). Cells without a figure give nobody.
- **Demolished buildings.** These are all standing buildings that come within half the route's width of its centre line, except the resident's home and the destination.
- **Trip times.** Trips are timed by car: 15 km/h through the old streets today, and 25, 35 or 50 km/h on a new route 12, 20 or 32 m wide. Widened streets keep their length but get the faster speed.
- **The walking reach.** It follows the walkable edges of `streets.graph.json` (plus the council's new routes) at 4.8 km/h, which is 80 m per minute, from the junction nearest your click.
  - Each area is the street segments reached in 5, 10 or 15 minutes, including the reachable part of the last segment, with a band of 25 m on each side, joined into one shape.
  - A building counts when it touches the area; demolished buildings don't.
  - Residents are each overlapping census cell's population times the share of the cell inside the area, rounded to the nearest 10. Cells without a published figure are left out, not counted as zero; the panel shows how many overlap.

## Limits

- The voices are a small, fast model (Haiku), speaking in character. They read the numbers well, but they're not a real public. The people are written to be impatient with detours: they back the design that saves the most time, accept demolition when the gain is real, and only prefer fewer displaced residents when two designs save about the same time. The Prefect and the Engineer lean wide; the Conservator is the voice of caution.
- **Displaced residents** are an estimate: the census changes small counts at random, and people are shared over buildings by volume, not counted per house.
  - About 4,400 of the census's 21,781 residents live in cells without a residential building centre and aren't assigned to any building.
  - The data calls some sheds and garages "residential"; a resident is only picked from buildings with at least one estimated resident.
- **The routes** are lines with a fixed width. They ignore slopes, junction design and traffic lights. A new route only joins the network at its two ends, not where it crosses other streets.
- **Car speeds** are rough, fixed assumptions.
- **The walking reach** uses one speed for everyone. Its 25 m band stands in for "the buildings along a street".
- **The data** covers only the kit area, about 1.3 × 2 km. Near its edges the network stops.
- **The city resets** when the page is reloaded; nothing is saved.

The earlier version, with a manual "Create an Axis" button that pushed buildings aside, is kept in git under the tag `axis-version`.

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

1. Tools: Claude Code, with the model Claude Opus 5.5 (`claude-opus-5-5`); the council's voices are Claude Haiku through `claude -p`.
2. I decided:
3. The agent did: it built the council (the facts in `src/council.js`, the loop, the log panel and the local `claude -p` endpoint), replaced the axis with it, and tested whole rounds on the real data and in a headless browser.
4. I checked:

### The earlier version (tag `axis-version`)

2. I decided: to add an axis generator that creates a boulevard between two selected buildings and pushes any buildings in its path out of the way, without checking where they end up. I also wanted an Arc de Triomphe at the axis’s midpoint and all buildings styled like Haussmann buildings, with white facades and dark grey roofs.

4. I checked: that the axis generates between any two buildings I selected, that blocking buildings move, that the Arc sits at the midpoint, and that the colours apply. I did not independently verify the resident numbers.
