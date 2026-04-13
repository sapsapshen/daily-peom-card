export const BRAND_ICON_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64" fill="none">
  <defs>
    <linearGradient id="poem-bg" x1="12" y1="10" x2="52" y2="56" gradientUnits="userSpaceOnUse">
      <stop stop-color="#2E3445"/>
      <stop offset="1" stop-color="#171B25"/>
    </linearGradient>
    <linearGradient id="poem-ring" x1="20" y1="16" x2="46" y2="46" gradientUnits="userSpaceOnUse">
      <stop stop-color="#EFF6FF" stop-opacity="0.95"/>
      <stop offset="1" stop-color="#BFD4F6" stop-opacity="0.78"/>
    </linearGradient>
    <linearGradient id="poem-moon" x1="22" y1="18" x2="39" y2="41" gradientUnits="userSpaceOnUse">
      <stop stop-color="#FFF7E7"/>
      <stop offset="1" stop-color="#DDE9FF"/>
    </linearGradient>
  </defs>
  <circle cx="32" cy="32" r="27" fill="url(#poem-bg)"/>
  <circle cx="32" cy="32" r="26.5" stroke="url(#poem-ring)" stroke-opacity="0.22"/>
  <circle cx="32" cy="32" r="22" stroke="#E8F0FF" stroke-opacity="0.12"/>
  <path d="M38.8 18.5C34.1 18.5 30.3 22.4 30.3 27.2C30.3 32.1 34.1 36 38.8 36C40.8 36 42.6 35.3 44 34.2C42.4 37.7 38.9 40.1 34.8 40.1C29.2 40.1 24.7 35.4 24.7 29.5C24.7 23.4 29.5 18.5 35.2 18.5H38.8Z" fill="url(#poem-moon)"/>
  <path d="M45.2 19.6L46 22.1L48.5 22.9L46 23.8L45.2 26.2L44.4 23.8L41.9 22.9L44.4 22.1L45.2 19.6Z" fill="#FFF5D6"/>
  <path d="M18.9 40.6L19.4 42.1L20.9 42.6L19.4 43.1L18.9 44.6L18.4 43.1L16.9 42.6L18.4 42.1L18.9 40.6Z" fill="#D7E6FF" fill-opacity="0.9"/>
  <rect x="37.8" y="38.4" width="2.4" height="8.8" rx="1.2" fill="#F3D89A" fill-opacity="0.9"/>
  <rect x="42.1" y="35.8" width="2.4" height="11.4" rx="1.2" fill="#EAF2FF" fill-opacity="0.82"/>
</svg>`;

export const getBrandIconDataUrl = () => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(BRAND_ICON_SVG)}`;
