const previewData = {
  x: {
    source: "assets/x-widget.png",
    alt: "Social-XP widget displayed on X",
    caption: "Keep today's target visible while you post and reply on X."
  },
  linkedin: {
    source: "assets/linkedin-widget-v2.png",
    alt: "Social-XP widget displayed on LinkedIn",
    caption: "Track publishing and thoughtful engagement without leaving LinkedIn."
  },
  threads: {
    source: "assets/threads-widget.png",
    alt: "Social-XP widget displayed on a mock Threads feed",
    caption: "Build a steady Threads habit while keeping today's target in view."
  },
  discord: {
    source: "assets/discord-widget.png",
    alt: "Social-XP widget displayed in a mock Discord community",
    caption: "Count meaningful community participation alongside public posts."
  },
  reddit: {
    source: "assets/reddit-widget.png",
    alt: "Social-XP widget displayed on a mock Reddit feed",
    caption: "Keep posts and useful community replies moving toward one daily goal."
  },
  facebook: {
    source: "assets/facebook-widget.png",
    alt: "Social-XP widget displayed on a mock Facebook feed",
    caption: "See your posting rhythm without leaving the Facebook feed."
  },
  bluesky: {
    source: "assets/bluesky-widget.png",
    alt: "Social-XP widget displayed on a mock Bluesky feed",
    caption: "Track Bluesky posts and replies with the same progression loop."
  },
  dashboard: {
    source: "assets/dashboard.png",
    alt: "Social-XP activity dashboard",
    caption: "Review XP flow, streaks, levels, goals, and activity by network."
  }
};

const previewImage = document.getElementById("previewImage");
const previewCaption = document.getElementById("previewCaption");

document.querySelectorAll("[data-preview]").forEach((button) => {
  button.addEventListener("click", () => {
    const key = button.dataset.preview;
    const next = previewData[key];

    if (!next) {
      return;
    }

    document.querySelectorAll("[data-preview]").forEach((candidate) => {
      const active = candidate === button;
      candidate.classList.toggle("is-active", active);
      candidate.setAttribute("aria-selected", String(active));
    });

    previewImage.src = next.source;
    previewImage.alt = next.alt;
    previewCaption.textContent = next.caption;
  });
});
