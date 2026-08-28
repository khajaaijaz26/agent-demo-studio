export const production = {
  id: "classroom-raindrop-cartoon-reel-2026",
  title: "The Journey of a Raindrop",
  description: "An original animated classroom mini-lesson about the water cycle, created for YouTube Shorts and Instagram Reels.",
  teacherVoice: "en-US-AvaNeural",
  studentVoice: "en-US-AnaNeural",
  palette: {
    navy: "#0B2545",
    sky: "#42B7E9",
    yellow: "#F7B733",
    coral: "#F26B5B",
    cream: "#FFF8E8",
    green: "#4BAE78"
  },
  scenes: [
    {
      id: "welcome",
      image: "01-welcome.png",
      label: "A RAINDROP'S JOURNEY",
      minimumDuration: 9,
      motion: "ken-burns-in",
      transition: { type: "cut", durationSeconds: 0.001 },
      dialogue: [
        { speaker: "teacher", text: "Good morning, explorers! Today we're following one tiny raindrop on an amazing journey through the water cycle." }
      ]
    },
    {
      id: "big-question",
      image: "02-big-question.png",
      label: "WHERE DOES WATER GO?",
      minimumDuration: 9,
      motion: "pan-right",
      transition: { type: "smooth-left", durationSeconds: 0.45 },
      dialogue: [
        { speaker: "teacher", text: "When sunshine warms oceans, lakes, and puddles, where does the water go? Watch closely." }
      ]
    },
    {
      id: "evaporation",
      image: "03-evaporation.png",
      label: "1  EVAPORATION",
      minimumDuration: 11,
      motion: "pan-up",
      transition: { type: "dissolve", durationSeconds: 0.45 },
      dialogue: [
        { speaker: "teacher", text: "It becomes invisible water vapor and rises. This is evaporation—the sun gives water energy to climb into the sky." }
      ]
    },
    {
      id: "condensation",
      image: "04-condensation.png",
      label: "2  CONDENSATION",
      minimumDuration: 11,
      motion: "pan-left",
      transition: { type: "reveal-left", durationSeconds: 0.45 },
      dialogue: [
        { speaker: "teacher", text: "High above us, cooler air turns vapor into tiny droplets. They gather into clouds. This is condensation." }
      ]
    },
    {
      id: "precipitation",
      image: "05-precipitation.png",
      label: "3  PRECIPITATION",
      minimumDuration: 12,
      motion: "ken-burns-in",
      transition: { type: "wipe-down", durationSeconds: 0.45 },
      dialogue: [
        { speaker: "teacher", text: "When clouds become heavy, water falls as rain, snow, or hail. This is precipitation, returning water to Earth." }
      ]
    },
    {
      id: "complete-cycle",
      image: "06-complete-cycle.png",
      label: "EVERY DROP HAS A STORY",
      minimumDuration: 16,
      motion: "ken-burns-out",
      transition: { type: "circle-open", durationSeconds: 0.5 },
      dialogue: [
        { speaker: "teacher", text: "Can anyone complete the cycle?" },
        { speaker: "student", text: "Evaporation, condensation, precipitation—and collection, as rivers, soil, and oceans gather the water." },
        { speaker: "teacher", text: "Exactly! Water keeps traveling around and around. Every drop has a story." }
      ]
    }
  ]
};
