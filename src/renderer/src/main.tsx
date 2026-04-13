import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import { getBrandIconDataUrl } from "@shared/brandIcon";

const applyBrandFavicon = () => {
  const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]') ?? document.createElement("link");
  favicon.rel = "icon";
  favicon.type = "image/png";
  favicon.sizes = "64x64";

  const image = new Image();
  image.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext("2d");
    context?.clearRect(0, 0, 64, 64);
    context?.drawImage(image, 0, 0, 64, 64);
    favicon.href = canvas.toDataURL("image/png");
    if (!favicon.parentNode) {
      document.head.appendChild(favicon);
    }
  };
  image.src = getBrandIconDataUrl();
};

applyBrandFavicon();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);