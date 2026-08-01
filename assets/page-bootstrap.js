"use strict";

(() => {
  const INTERNAL_NAVIGATION_KEY = "socialXpInternalNavigation";
  const THEME_PREFERENCE_KEY = "socialXpThemePreference";

  try {
    const themePreference = window.localStorage.getItem(THEME_PREFERENCE_KEY) === "light" ? "light" : "dark";
    document.documentElement.classList.toggle("socialxp-light-theme", themePreference === "light");
    document.documentElement.style.colorScheme = themePreference;
  } catch {
    document.documentElement.style.colorScheme = "dark";
  }

  try {
    if (window.sessionStorage.getItem(INTERNAL_NAVIGATION_KEY) === "1") {
      document.documentElement.classList.add("socialxp-internal-navigation");
      window.sessionStorage.removeItem(INTERNAL_NAVIGATION_KEY);
    }
  } catch {
    // Extension pages still work when session storage is unavailable.
  }

  window.SocialXpPageNavigation = Object.freeze({
    markInternal() {
      try {
        window.sessionStorage.setItem(INTERNAL_NAVIGATION_KEY, "1");
      } catch {
        // Navigation can proceed without the transition marker.
      }
    }
  });
})();
