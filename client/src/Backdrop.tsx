import { useEffect, useState } from "react";
import { DEFAULT_POOL, mapThumb } from "./maps";

const SLIDES = DEFAULT_POOL.flatMap((map) => [mapThumb(map, 1), mapThumb(map, 2)]);

export default function Backdrop() {
  const [index, setIndex] = useState(() => Math.floor(Math.random() * SLIDES.length));

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % SLIDES.length), 9000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div aria-hidden="true" className="backdrop">
      {SLIDES.map((src, i) => (
        <div
          className={`backdrop-slide${i === index ? " is-active" : ""}`}
          key={src}
          style={Math.abs(i - index) <= 1 || Math.abs(i - index) === SLIDES.length - 1 ? { backgroundImage: `url(${src})` } : undefined}
        />
      ))}
      <div className="backdrop-shade" />
      <div className="backdrop-grain" />
    </div>
  );
}
