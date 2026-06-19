import { t } from "./i18n.js";

export function timeAgo(dateStr) {
  if (!dateStr) return null;
  let date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    const parts = dateStr.match(/(\d+)/g);
    if (parts && parts.length >= 3) {
      if (parts[0].length === 4) {
        date = new Date(
          parts[0],
          parts[1] - 1,
          parts[2],
          parts[3] || 0,
          parts[4] || 0,
          parts[5] || 0,
        );
      } else if (parts[2].length === 4) {
        date = new Date(
          parts[2],
          parts[1] - 1,
          parts[0],
          parts[3] || 0,
          parts[4] || 0,
          parts[5] || 0,
        );
      }
    }
  }
  if (isNaN(date.getTime())) return null;
  const now = new Date();
  const diffMs = now - date;
  if (diffMs < 0) return t("just_now");
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  if (diffMins < 1) return t("just_now");
  if (diffMins < 60) return t("minutes_ago", { n: diffMins });
  if (diffHours < 24) return t("hours_ago", { n: diffHours });
  return t("days_ago", { n: diffDays });
}

export function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function priceColor(price, minPrice, maxPrice) {
  if (minPrice === maxPrice) return "#f5a623";
  const v = (price - minPrice) / (maxPrice - minPrice);
  if (v < 0.5) {
    const r = Math.round(62 + (245 - 62) * v * 2);
    const g = Math.round(207 + (166 - 207) * v * 2);
    const b = Math.round(142 + (35 - 142) * v * 2);
    return `rgb(${r},${g},${b})`;
  } else {
    const tt = (v - 0.5) * 2;
    const r = Math.round(245 + (232 - 245) * tt);
    const g = Math.round(166 + (67 - 166) * tt);
    const b = Math.round(35 + (26 - 35) * tt);
    return `rgb(${r},${g},${b})`;
  }
}

export function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Radius of the earth in km
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) *
      Math.cos(deg2rad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in km
}

function deg2rad(deg) {
  return deg * (Math.PI / 180);
}
