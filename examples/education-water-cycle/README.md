# Water-cycle educational proof

Three original 1920×1080 SVG scene plates for the local end-to-end educational
video smoke test. They contain no external fonts, photos, samples, or downloaded
artwork and are covered by the repository MIT license.

```bash
agent-demo creator prompt \
  "Teach children ages 8 to 11 the water cycle in three accurate steps: evaporation, condensation, and precipitation with collection. Use plain language and a short recap." \
  --title "The Water Cycle in Three Steps" \
  --mode cartoon --duration 42 --presenter none \
  --narration "Sunlight warms water in oceans, lakes, and rivers. Liquid water changes into invisible water vapor and rises. Higher in the sky, the vapor cools during condensation. It gathers into tiny droplets that form clouds. When droplets become heavy, precipitation falls as rain or snow. Water collects in rivers, lakes, soil, and oceans, ready to begin the cycle again." \
  --scene-sources ./examples/education-water-cycle/scene-1-evaporation.svg,./examples/education-water-cycle/scene-2-condensation.svg,./examples/education-water-cycle/scene-3-precipitation.svg \
  --planner auto --planner-profile fast \
  --voice-provider local --presets youtube-1080p --render
```
