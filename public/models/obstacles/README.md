# Obstacle model assets

The GLB files in this directory are selected from Kenney's **Car Kit 3.1** and
**Nature Kit 1.0**.

- Creator/distributor: Kenney — https://www.kenney.nl/
- Source packs: https://www.kenney.nl/assets/car-kit and https://www.kenney.nl/assets/nature-kit
- License: Creative Commons Zero (CC0 1.0) — https://creativecommons.org/publicdomain/zero/1.0/
- Permitted uses: personal, educational, and commercial. Attribution is appreciated
  by the creator but is not required by the license.

The files were renamed to match the planner's obstacle variants. In particular,
`pickup.glb` comes from `truck.glb`, and `truck.glb` comes from `delivery.glb` in the
Car Kit.

The original vehicle files referenced the shared `Textures/colormap.png` palette. The
palette has been embedded into each vehicle GLB with `scripts/embed-obstacle-texture.mjs`
so the models remain colored when deployed, cached, or relocated.
