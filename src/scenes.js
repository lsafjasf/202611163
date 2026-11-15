import { clamp, getSceneAt, getLocalTime, roundTime } from "./project.js";

const particleCache = new Map();
const grainCache = new Map();

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function getParticles(scene) {
  if (particleCache.has(scene.id)) return particleCache.get(scene.id);
  const random = seededRandom(hashString(`${scene.id}-${scene.visual}`));
  const particles = Array.from({ length: 70 }, () => ({
    x: random(),
    y: random(),
    size: 0.4 + random() * 2.1,
    speed: 0.3 + random() * 1.5,
    phase: random() * Math.PI * 2,
    alpha: 0.15 + random() * 0.65,
  }));
  particleCache.set(scene.id, particles);
  return particles;
}

function getGrainTile() {
  if (grainCache.has("tile")) return grainCache.get("tile");
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 96;
  const context = canvas.getContext("2d");
  const image = context.createImageData(96, 96);
  const random = seededRandom(42831);
  for (let index = 0; index < image.data.length; index += 4) {
    const value = Math.floor(random() * 255);
    image.data[index] = value;
    image.data[index + 1] = value;
    image.data[index + 2] = value;
    image.data[index + 3] = Math.floor(random() * 21);
  }
  context.putImageData(image, 0, 0);
  grainCache.set("tile", canvas);
  return canvas;
}

function linearGradient(context, x0, y0, x1, y1, stops) {
  const gradient = context.createLinearGradient(x0, y0, x1, y1);
  stops.forEach(([offset, color]) => gradient.addColorStop(offset, color));
  return gradient;
}

function radialGradient(context, x, y, radius, stops) {
  const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
  stops.forEach(([offset, color]) => gradient.addColorStop(offset, color));
  return gradient;
}

function withAlpha(hex, alpha) {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return `rgba(255, 255, 255, ${alpha})`;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function drawGrain(context, width, height, alpha = 0.38) {
  const tile = getGrainTile();
  const pattern = context.createPattern(tile, "repeat");
  if (!pattern) return;
  context.save();
  context.globalAlpha = alpha;
  context.fillStyle = pattern;
  context.fillRect(0, 0, width, height);
  context.restore();
}

function drawVignette(context, width, height, strength = 0.42) {
  const gradient = context.createRadialGradient(
    width * 0.5,
    height * 0.45,
    width * 0.08,
    width * 0.5,
    height * 0.5,
    width * 0.66,
  );
  gradient.addColorStop(0, "rgba(0,0,0,0)");
  gradient.addColorStop(0.63, "rgba(0,0,0,0.02)");
  gradient.addColorStop(1, `rgba(0,0,0,${strength})`);
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
}

function line(context, x0, y0, x1, y1) {
  context.beginPath();
  context.moveTo(x0, y0);
  context.lineTo(x1, y1);
  context.stroke();
}

function interpolateKeyframes(scene, localTime) {
  const frames = scene.keyframes;
  if (!frames || frames.length === 0) {
    return { zoom: 1, x: 0.5, y: 0.5 };
  }
  if (localTime <= frames[0].time) return frames[0];
  if (localTime >= frames[frames.length - 1].time) {
    return frames[frames.length - 1];
  }
  for (let index = 0; index < frames.length - 1; index += 1) {
    const current = frames[index];
    const next = frames[index + 1];
    if (localTime >= current.time && localTime <= next.time) {
      const span = Math.max(0.001, next.time - current.time);
      let progress = (localTime - current.time) / span;
      progress = progress * progress * (3 - 2 * progress);
      return {
        zoom: current.zoom + (next.zoom - current.zoom) * progress,
        x: current.x + (next.x - current.x) * progress,
        y: current.y + (next.y - current.y) * progress,
      };
    }
  }
  return frames[frames.length - 1];
}

function drawFerry(context, width, height, scene, time) {
  const horizon = height * 0.59;
  context.fillStyle = linearGradient(context, 0, 0, 0, horizon, [
    [0, "#061218"],
    [0.56, "#173941"],
    [0.84, "#6c5947"],
    [1, "#b17c4d"],
  ]);
  context.fillRect(0, 0, width, horizon + 2);

  const moonX = width * 0.76;
  const moonY = height * 0.23;
  const moonRadius = width * 0.038;
  context.fillStyle = radialGradient(context, moonX, moonY, width * 0.15, [
    [0, "rgba(255,234,184,0.3)"],
    [0.24, "rgba(250,210,144,0.12)"],
    [1, "rgba(240,180,90,0)"],
  ]);
  context.fillRect(0, 0, width, height * 0.55);
  context.fillStyle = "#f6ddb0";
  context.beginPath();
  context.arc(moonX, moonY, moonRadius, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "rgba(98,113,111,0.15)";
  context.beginPath();
  context.arc(moonX - moonRadius * 0.28, moonY - moonRadius * 0.18, moonRadius * 0.19, 0, Math.PI * 2);
  context.arc(moonX + moonRadius * 0.34, moonY + moonRadius * 0.2, moonRadius * 0.12, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = "#102a30";
  context.beginPath();
  context.moveTo(0, horizon);
  context.lineTo(0, height * 0.49);
  context.bezierCurveTo(width * 0.12, height * 0.42, width * 0.2, height * 0.53, width * 0.35, height * 0.51);
  context.bezierCurveTo(width * 0.5, height * 0.48, width * 0.67, height * 0.55, width, height * 0.45);
  context.lineTo(width, horizon);
  context.closePath();
  context.fill();

  context.fillStyle = linearGradient(context, 0, horizon, 0, height, [
    [0, "#263c3f"],
    [0.45, "#0c242c"],
    [1, "#051116"],
  ]);
  context.fillRect(0, horizon, width, height - horizon);

  const shimmerX = width * 0.76;
  context.lineWidth = Math.max(1, width * 0.0012);
  for (let index = 0; index < 33; index += 1) {
    const y = horizon + (index / 33) * (height - horizon);
    const spread = (index / 33) * width * 0.15 + width * 0.015;
    const sway = Math.sin(time * 1.4 + index * 1.77) * width * 0.018;
    context.strokeStyle = `rgba(244,185,102,${0.25 * (1 - index / 42)})`;
    line(context, shimmerX - spread + sway, y, shimmerX + spread + sway, y);
  }

  const boatX = width * (0.22 + Math.sin(time * 0.32) * 0.012);
  const boatY = height * (0.67 + Math.sin(time * 1.1) * 0.003);
  context.save();
  context.translate(boatX, boatY);
  context.fillStyle = "#030909";
  context.beginPath();
  context.moveTo(-width * 0.09, 0);
  context.quadraticCurveTo(-width * 0.055, height * 0.034, width * 0.075, height * 0.025);
  context.lineTo(width * 0.095, 0);
  context.quadraticCurveTo(width * 0.02, height * 0.025, -width * 0.09, 0);
  context.fill();
  context.fillRect(-width * 0.038, -height * 0.08, width * 0.003, height * 0.08);
  context.strokeStyle = "#020707";
  context.lineWidth = Math.max(1, width * 0.002);
  line(context, -width * 0.04, -height * 0.073, width * 0.037, height * 0.015);
  line(context, -width * 0.004, -height * 0.079, width * 0.057, height * 0.01);
  context.fillStyle = "#e8a34e";
  context.beginPath();
  context.arc(-width * 0.018, -height * 0.038, width * 0.006, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = radialGradient(context, -width * 0.018, -height * 0.038, width * 0.038, [
    [0, "rgba(255,185,82,0.32)"],
    [1, "rgba(255,170,55,0)"],
  ]);
  context.fillRect(-width * 0.06, -height * 0.08, width * 0.09, height * 0.09);
  context.restore();

  context.strokeStyle = "rgba(2,9,9,0.92)";
  context.lineWidth = Math.max(1.2, width * 0.0025);
  const reedBase = height * 1.02;
  for (let index = 0; index < 43; index += 1) {
    const x = (index / 43) * width * 0.23;
    const sway = Math.sin(time * 0.65 + index * 0.8) * width * 0.006;
    context.beginPath();
    context.moveTo(x, reedBase);
    context.quadraticCurveTo(x + sway * 0.4, height * 0.88, x - width * 0.02 + sway, height * (0.63 + (index % 6) * 0.04));
    context.stroke();
  }

  const particles = getParticles(scene);
  for (const particle of particles.slice(0, 18)) {
    const x = width * (particle.x + Math.sin(time * particle.speed + particle.phase) * 0.008);
    const y = height * (particle.y * 0.47 + Math.cos(time * particle.speed * 0.7 + particle.phase) * 0.007);
    context.fillStyle = `rgba(239,186,105,${particle.alpha * 0.55})`;
    context.beginPath();
    context.arc(x, y, particle.size * 0.55, 0, Math.PI * 2);
    context.fill();
  }
}

function drawAlley(context, width, height, scene, time) {
  context.fillStyle = linearGradient(context, 0, 0, 0, height, [
    [0, "#0d0c17"],
    [0.48, "#35263f"],
    [1, "#120e15"],
  ]);
  context.fillRect(0, 0, width, height);

  const glowX = width * 0.73;
  const glowY = height * 0.28;
  context.fillStyle = radialGradient(context, glowX, glowY, width * 0.24, [
    [0, "rgba(226,102,88,0.18)"],
    [1, "rgba(226,102,88,0)"],
  ]);
  context.fillRect(0, 0, width, height);

  context.fillStyle = "#15101c";
  context.beginPath();
  context.moveTo(0, 0);
  context.lineTo(width * 0.34, 0);
  context.lineTo(width * 0.405, height * 0.78);
  context.lineTo(0, height);
  context.closePath();
  context.fill();
  context.beginPath();
  context.moveTo(width, 0);
  context.lineTo(width * 0.7, 0);
  context.lineTo(width * 0.6, height * 0.8);
  context.lineTo(width, height);
  context.closePath();
  context.fill();

  context.fillStyle = linearGradient(context, 0, height * 0.48, 0, height, [
    [0, "#56424e"],
    [0.45, "#322932"],
    [1, "#131116"],
  ]);
  context.beginPath();
  context.moveTo(width * 0.38, height * 0.54);
  context.lineTo(width * 0.62, height * 0.54);
  context.lineTo(width * 0.79, height);
  context.lineTo(width * 0.14, height);
  context.closePath();
  context.fill();

  context.strokeStyle = "rgba(236,178,135,0.18)";
  context.lineWidth = Math.max(1, width * 0.001);
  for (let index = 0; index < 8; index += 1) {
    const y = height * (0.58 + index * 0.06);
    const spread = (y / height - 0.5) * width * 0.5;
    line(context, width * 0.5 - spread, y, width * 0.5 + spread, y);
  }

  const signX = width * 0.745;
  context.save();
  context.shadowColor = "rgba(237,104,91,0.85)";
  context.shadowBlur = width * 0.025;
  context.fillStyle = "#d75953";
  context.fillRect(signX, height * 0.19, width * 0.018, height * 0.2);
  context.fillStyle = "rgba(255,198,147,0.75)";
  for (let index = 0; index < 4; index += 1) {
    context.fillRect(signX + width * 0.006, height * (0.22 + index * 0.037), width * 0.006, height * 0.004);
  }
  context.restore();
  context.fillStyle = "rgba(225,106,94,0.12)";
  context.fillRect(signX - width * 0.03, height * 0.18, width * 0.1, height * 0.23);

  const walkX = width * (0.39 + Math.sin(time * 0.45) * 0.005);
  const walkY = height * 0.69;
  context.fillStyle = "#09090d";
  context.beginPath();
  context.arc(walkX, walkY - height * 0.11, height * 0.026, 0, Math.PI * 2);
  context.fill();
  context.beginPath();
  context.moveTo(walkX - width * 0.012, walkY - height * 0.085);
  context.lineTo(walkX + width * 0.015, walkY - height * 0.085);
  context.lineTo(walkX + width * 0.025, walkY + height * 0.035);
  context.lineTo(walkX - width * 0.017, walkY + height * 0.035);
  context.closePath();
  context.fill();
  line(context, walkX - width * 0.004, walkY + height * 0.034, walkX - width * 0.012, walkY + height * 0.12);
  line(context, walkX + width * 0.01, walkY + height * 0.034, walkX + width * 0.02, walkY + height * 0.115);
  const umbrellaY = walkY - height * 0.14;
  context.strokeStyle = "#9298a0";
  context.lineWidth = Math.max(1, width * 0.0014);
  context.beginPath();
  context.arc(walkX, umbrellaY, height * 0.086, Math.PI, Math.PI * 2);
  context.stroke();
  context.fillStyle = "rgba(116,94,109,0.64)";
  context.beginPath();
  context.arc(walkX, umbrellaY, height * 0.086, Math.PI, Math.PI * 2);
  context.fill();
  line(context, walkX, umbrellaY, walkX, umbrellaY + height * 0.095);

  const random = seededRandom(981);
  context.lineWidth = Math.max(0.6, width * 0.0007);
  for (let index = 0; index < 88; index += 1) {
    const baseX = random() * width;
    const baseY = random() * height;
    const speed = 0.07 + random() * 0.11;
    const drop = height * 0.16;
    const y = (baseY + time * speed * height) % (height + drop) - drop;
    const x = baseX + y * 0.025;
    context.strokeStyle = `rgba(211,198,207,${0.1 + random() * 0.2})`;
    line(context, x, y, x - height * 0.006, y + height * 0.047);
  }

  context.fillStyle = radialGradient(context, width * 0.53, height * 0.94, width * 0.16, [
    [0, "rgba(226,120,97,0.16)"],
    [1, "rgba(226,120,97,0)"],
  ]);
  context.fillRect(width * 0.28, height * 0.72, width * 0.52, height * 0.28);
  drawGrain(context, width, height, 0.34);
  context.fillStyle = "rgba(6,6,10,0.18)";
  context.fillRect(0, 0, width, height);
}

function drawRooftop(context, width, height, scene, time) {
  const horizon = height * 0.655;
  context.fillStyle = linearGradient(context, 0, 0, 0, horizon, [
    [0, "#15121c"],
    [0.38, "#4c2e35"],
    [0.69, "#a65b42"],
    [0.9, "#e2a15f"],
    [1, "#efbd78"],
  ]);
  context.fillRect(0, 0, width, horizon);

  const sunX = width * 0.68;
  const sunY = height * 0.425;
  const sunRadius = width * 0.058;
  context.fillStyle = radialGradient(context, sunX, sunY, width * 0.24, [
    [0, "rgba(255,226,159,0.52)"],
    [0.23, "rgba(249,179,102,0.22)"],
    [1, "rgba(244,155,77,0)"],
  ]);
  context.fillRect(0, 0, width, height * 0.75);
  context.fillStyle = "#ffd18e";
  context.beginPath();
  context.arc(sunX, sunY, sunRadius, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = "rgba(65,36,38,0.18)";
  for (let index = 0; index < 6; index += 1) {
    const y = height * (0.3 + index * 0.038);
    const offset = Math.sin(time * 0.18 + index) * width * 0.02;
    context.fillRect(width * (0.1 + index * 0.11) + offset, y, width * 0.31, height * 0.008);
  }

  const random = seededRandom(4401);
  const buildings = [];
  let x = -width * 0.02;
  while (x < width * 1.03) {
    const buildingWidth = width * (0.025 + random() * 0.052);
    const buildingHeight = height * (0.08 + random() * 0.19);
    buildings.push({ x, width: buildingWidth, height: buildingHeight, seed: random() });
    x += buildingWidth + width * (0.004 + random() * 0.012);
  }
  buildings.forEach((building, index) => {
    const top = horizon - building.height;
    context.fillStyle = index % 3 === 0 ? "#2a2028" : "#251c23";
    context.fillRect(building.x, top, building.width, building.height + 5);
    if (building.seed > 0.68) {
      context.fillRect(
        building.x + building.width * 0.22,
        top - height * 0.045,
        Math.max(1, width * 0.002),
        height * 0.045,
      );
    }
    context.fillStyle = "rgba(242,172,95,0.34)";
    const columns = Math.max(2, Math.floor(building.width / (width * 0.018)));
    const rows = Math.max(2, Math.floor(building.height / (height * 0.032)));
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        if ((row * 7 + column * 3 + index) % 5 === 0) {
          context.fillRect(
            building.x + width * 0.004 + column * width * 0.015,
            top + height * 0.013 + row * height * 0.027,
            width * 0.0045,
            height * 0.007,
          );
        }
      }
    }
  });

  context.fillStyle = "rgba(229,154,89,0.17)";
  context.fillRect(0, horizon - height * 0.04, width, height * 0.05);

  const roofTop = height * 0.71;
  context.fillStyle = linearGradient(context, 0, roofTop, 0, height, [
    [0, "#1c1719"],
    [1, "#0b0b0e"],
  ]);
  context.beginPath();
  context.moveTo(0, roofTop);
  context.lineTo(width, roofTop - height * 0.025);
  context.lineTo(width, height);
  context.lineTo(0, height);
  context.closePath();
  context.fill();

  context.strokeStyle = "rgba(222,158,104,0.12)";
  context.lineWidth = 1;
  for (let index = 0; index < 9; index += 1) {
    const startX = (index / 9) * width;
    line(context, startX, height, startX + width * 0.11, roofTop + height * 0.005);
  }

  const railingY = height * 0.6;
  context.strokeStyle = "#120f12";
  context.lineWidth = Math.max(2, width * 0.004);
  line(context, width * 0.03, railingY, width * 0.97, railingY);
  for (let index = 0; index < 15; index += 1) {
    const postX = width * (0.04 + index * 0.066);
    line(context, postX, railingY, postX, height * 0.74);
  }
  context.lineWidth = Math.max(1, width * 0.0017);
  line(context, width * 0.03, railingY + height * 0.04, width * 0.97, railingY + height * 0.04);

  const antennaX = width * 0.823;
  context.strokeStyle = "#0b090b";
  context.lineWidth = Math.max(2, width * 0.004);
  line(context, antennaX, roofTop + 3, antennaX, height * 0.27);
  line(context, antennaX - width * 0.055, height * 0.37, antennaX + width * 0.055, height * 0.37);
  line(context, antennaX - width * 0.035, height * 0.31, antennaX + width * 0.035, height * 0.31);
  const blink = Math.sin(time * 4.2) > 0.1;
  if (blink) {
    context.fillStyle = "rgba(241,95,68,0.3)";
    context.beginPath();
    context.arc(antennaX, height * 0.265, width * 0.018, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#f26b4d";
    context.beginPath();
    context.arc(antennaX, height * 0.265, width * 0.0038, 0, Math.PI * 2);
    context.fill();
  }

  const figureX = width * 0.385;
  const figureY = height * 0.67;
  context.fillStyle = "#08090a";
  context.beginPath();
  context.arc(figureX, figureY - height * 0.11, height * 0.019, 0, Math.PI * 2);
  context.fill();
  context.beginPath();
  context.moveTo(figureX - width * 0.015, figureY - height * 0.087);
  context.quadraticCurveTo(figureX, figureY - height * 0.1, figureX + width * 0.016, figureY - height * 0.087);
  context.lineTo(figureX + width * 0.013, figureY + height * 0.015);
  context.lineTo(figureX - width * 0.013, figureY + height * 0.015);
  context.closePath();
  context.fill();
  line(context, figureX - width * 0.004, figureY + height * 0.014, figureX - width * 0.008, figureY + height * 0.079);
  line(context, figureX + width * 0.006, figureY + height * 0.014, figureX + width * 0.011, figureY + height * 0.079);

  context.strokeStyle = "rgba(19,15,17,0.88)";
  context.lineWidth = Math.max(1, width * 0.0012);
  for (let index = 0; index < 5; index += 1) {
    const birdX = width * (0.11 + index * 0.04) + Math.sin(time * 0.45 + index) * width * 0.009;
    const birdY = height * (0.23 + (index % 3) * 0.025);
    context.beginPath();
    context.arc(birdX, birdY, width * 0.007, Math.PI * 1.15, Math.PI * 1.9);
    context.arc(birdX + width * 0.013, birdY, width * 0.007, Math.PI * 1.1, Math.PI * 1.85);
    context.stroke();
  }

  const particles = getParticles(scene);
  for (const particle of particles.slice(0, 13)) {
    const x = width * particle.x;
    const y = height * (0.55 + particle.y * 0.17);
    context.fillStyle = `rgba(239,174,105,${particle.alpha * 0.2})`;
    context.fillRect(x, y, particle.size * 0.7, particle.size * 0.7);
  }
  drawGrain(context, width, height, 0.33);
}

function drawTunnel(context, width, height, scene, time) {
  context.fillStyle = "#070505";
  context.fillRect(0, 0, width, height);
  const centerX = width * 0.505 + Math.sin(time * 0.35) * width * 0.003;
  const centerY = height * 0.455;

  context.fillStyle = radialGradient(context, centerX, centerY, width * 0.36, [
    [0, "#f4c47a"],
    [0.02, "#bb6c3c"],
    [0.12, "#3c211a"],
    [0.55, "#120b09"],
    [1, "#050404"],
  ]);
  context.fillRect(0, 0, width, height);

  context.save();
  context.strokeStyle = "rgba(214,102,64,0.38)";
  context.lineWidth = Math.max(1, width * 0.0013);
  for (let index = 0; index < 22; index += 1) {
    const angle = (index / 22) * Math.PI * 2;
    context.beginPath();
    context.moveTo(centerX + Math.cos(angle) * width * 0.017, centerY + Math.sin(angle) * height * 0.022);
    context.lineTo(centerX + Math.cos(angle) * width * 0.55, centerY + Math.sin(angle) * height * 0.7);
    context.stroke();
  }
  context.restore();

  const phase = (time * 0.26) % 1;
  for (let index = 0; index < 8; index += 1) {
    const progress = ((index + phase) % 8) / 8;
    const eased = Math.pow(progress, 2.2);
    const ringWidth = width * (0.07 + eased * 0.72);
    const ringHeight = height * (0.09 + eased * 0.78);
    const alpha = 0.09 + progress * 0.42;
    context.strokeStyle = `rgba(238,114,69,${alpha})`;
    context.lineWidth = Math.max(1, width * (0.001 + progress * 0.004));
    context.beginPath();
    context.roundRect(
      centerX - ringWidth / 2,
      centerY - ringHeight / 2,
      ringWidth,
      ringHeight,
      Math.min(ringWidth, ringHeight) * 0.48,
    );
    context.stroke();
  }

  const roadTop = centerY + height * 0.075;
  context.fillStyle = "#090707";
  context.beginPath();
  context.moveTo(centerX - width * 0.055, roadTop);
  context.lineTo(centerX + width * 0.055, roadTop);
  context.lineTo(width * 1.15, height);
  context.lineTo(-width * 0.15, height);
  context.closePath();
  context.fill();

  for (let index = 0; index < 6; index += 1) {
    const progress = ((index + phase) % 6) / 6;
    const eased = Math.pow(progress, 2.5);
    const y = roadTop + eased * (height - roadTop);
    const dashWidth = width * (0.002 + eased * 0.04);
    const dashHeight = height * (0.003 + eased * 0.045);
    context.fillStyle = `rgba(229,181,104,${0.2 + progress * 0.55})`;
    context.fillRect(centerX - dashWidth / 2, y, dashWidth, dashHeight);
    context.fillStyle = `rgba(245,135,76,${0.46 + progress * 0.44})`;
    context.fillRect(centerX - eased * width * 0.32, y, width * (0.008 + eased * 0.11), height * 0.005);
    context.fillRect(centerX + eased * width * 0.32, y, width * (0.008 + eased * 0.11), height * 0.005);
  }

  const pulse = 0.4 + Math.sin(time * 6.1) * 0.12;
  context.fillStyle = `rgba(255,201,119,${pulse})`;
  context.beginPath();
  context.ellipse(centerX, centerY + height * 0.015, width * 0.055, height * 0.035, 0, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = radialGradient(context, centerX, centerY + height * 0.02, width * 0.2, [
    [0, "rgba(255,188,93,0.22)"],
    [1, "rgba(255,188,93,0)"],
  ]);
  context.fillRect(centerX - width * 0.25, centerY - height * 0.15, width * 0.5, height * 0.35);

  context.fillStyle = "rgba(0,0,0,0.88)";
  context.beginPath();
  context.moveTo(0, height);
  context.lineTo(0, height * 0.89);
  context.quadraticCurveTo(width * 0.2, height * 0.94, width * 0.35, height);
  context.closePath();
  context.fill();
  context.beginPath();
  context.moveTo(width, height);
  context.lineTo(width, height * 0.89);
  context.quadraticCurveTo(width * 0.8, height * 0.94, width * 0.65, height);
  context.closePath();
  context.fill();
  drawGrain(context, width, height, 0.48);
}

function drawSignal(context, width, height, scene, time) {
  const horizon = height * 0.54;
  context.fillStyle = linearGradient(context, 0, 0, 0, height, [
    [0, "#041210"],
    [0.4, "#0c2924"],
    [0.59, "#315f51"],
    [0.61, "#132e28"],
    [1, "#06100e"],
  ]);
  context.fillRect(0, 0, width, height);

  const particles = getParticles(scene);
  for (const particle of particles.slice(0, 54)) {
    const x = width * particle.x;
    const y = height * (particle.y * 0.5);
    const twinkle = 0.55 + Math.sin(time * particle.speed * 2.2 + particle.phase) * 0.35;
    context.fillStyle = `rgba(149,224,207,${particle.alpha * twinkle * 0.28})`;
    context.beginPath();
    context.arc(x, y, particle.size * 0.38, 0, Math.PI * 2);
    context.fill();
  }

  context.strokeStyle = "rgba(82,190,166,0.19)";
  context.lineWidth = 1;
  for (let index = 0; index < 11; index += 1) {
    const y = horizon + Math.pow(index / 11, 1.6) * height * 0.31;
    line(context, 0, y, width, y);
  }
  for (let index = -5; index < 12; index += 1) {
    line(context, width * 0.5 + index * width * 0.055, horizon, width * 0.5 + index * width * 0.18, height);
  }

  context.fillStyle = "#071612";
  context.beginPath();
  context.moveTo(0, horizon);
  context.bezierCurveTo(width * 0.19, horizon - height * 0.09, width * 0.34, horizon - height * 0.02, width * 0.49, horizon + height * 0.02);
  context.bezierCurveTo(width * 0.68, horizon + height * 0.06, width * 0.79, horizon - height * 0.045, width, horizon + height * 0.015);
  context.lineTo(width, height);
  context.lineTo(0, height);
  context.closePath();
  context.fill();

  const towerX = width * 0.625;
  const towerBase = horizon + height * 0.16;
  const towerTop = height * 0.185;
  context.strokeStyle = "#83aa9a";
  context.lineWidth = Math.max(1, width * 0.0012);
  line(context, towerX - width * 0.045, towerBase, towerX, towerTop);
  line(context, towerX + width * 0.045, towerBase, towerX, towerTop);
  for (let index = 1; index < 9; index += 1) {
    const progress = index / 9;
    const y = towerTop + (towerBase - towerTop) * progress;
    const half = width * 0.045 * progress;
    line(context, towerX - half, y, towerX + half, y);
    line(context, towerX - half, y, towerX + half * 0.55, towerTop + (towerBase - towerTop) * (progress + 0.11));
    line(context, towerX + half, y, towerX - half * 0.55, towerTop + (towerBase - towerTop) * (progress + 0.11));
  }
  context.lineWidth = Math.max(2, width * 0.004);
  line(context, towerX, towerTop, towerX, height * 0.09);
  line(context, towerX - width * 0.016, height * 0.135, towerX + width * 0.016, height * 0.135);

  const radarPulse = (time * 0.33) % 1;
  for (let index = 0; index < 3; index += 1) {
    const progress = (radarPulse + index / 3) % 1;
    const radius = width * (0.03 + progress * 0.24);
    context.strokeStyle = `rgba(94,224,195,${0.28 * (1 - progress)})`;
    context.lineWidth = Math.max(1, width * 0.0015);
    context.beginPath();
    context.arc(towerX, height * 0.135, radius, Math.PI * 0.88, Math.PI * 1.12);
    context.stroke();
  }

  const blink = Math.sin(time * 5.5) > 0;
  if (blink) {
    context.fillStyle = "rgba(95,240,203,0.22)";
    context.beginPath();
    context.arc(towerX, height * 0.087, width * 0.021, 0, Math.PI * 2);
    context.fill();
  }
  context.fillStyle = blink ? "#70f0cc" : "#325e52";
  context.beginPath();
  context.arc(towerX, height * 0.087, width * 0.004, 0, Math.PI * 2);
  context.fill();

  const waveY = height * 0.82;
  context.fillStyle = "rgba(4,14,12,0.78)";
  context.fillRect(0, waveY - height * 0.055, width, height * 0.15);
  context.strokeStyle = "rgba(86,224,194,0.19)";
  context.lineWidth = 1;
  line(context, width * 0.04, waveY, width * 0.96, waveY);
  context.strokeStyle = "rgba(91,225,197,0.72)";
  context.lineWidth = Math.max(1, width * 0.0015);
  context.beginPath();
  for (let pixel = 0; pixel <= width; pixel += Math.max(2, width * 0.002)) {
    const normalized = pixel / width;
    const signal =
      Math.sin(normalized * 82 + time * 6.4) * 0.43 +
      Math.sin(normalized * 23 - time * 2.1) * 0.25 +
      Math.sin(normalized * 151 + time * 9.2) * 0.08;
    const envelope = Math.pow(Math.sin(normalized * Math.PI), 0.8);
    const y = waveY + signal * height * 0.045 * envelope;
    if (pixel === 0) context.moveTo(pixel, y);
    else context.lineTo(pixel, y);
  }
  context.stroke();

  context.fillStyle = "rgba(91,225,197,0.42)";
  context.font = `${Math.max(7, width * 0.0075)}px "DM Mono", monospace`;
  context.letterSpacing = "0.12em";
  context.fillText("SIGNAL / 03:42:18", width * 0.045, waveY - height * 0.062);
  context.fillStyle = "rgba(71,188,164,0.08)";
  context.fillRect(0, height * 0.49, width, height * 0.23);
  drawGrain(context, width, height, 0.44);
}

function drawDawn(context, width, height, scene, time) {
  const progress = clamp(time / Math.max(1, scene.sourceOut - scene.sourceIn), 0, 1);
  const horizon = height * 0.67;
  context.fillStyle = linearGradient(context, 0, 0, 0, horizon, [
    [0, "#1d202c"],
    [0.22, "#524253"],
    [0.49, "#c16d63"],
    [0.76, "#f1a477"],
    [1, "#ffd799"],
  ]);
  context.fillRect(0, 0, width, horizon);

  const sunX = width * 0.49;
  const sunY = height * (0.56 - progress * 0.11);
  const sunRadius = width * 0.06;
  context.fillStyle = radialGradient(context, sunX, sunY, width * 0.3, [
    [0, "rgba(255,239,190,0.85)"],
    [0.11, "rgba(255,205,134,0.44)"],
    [0.36, "rgba(241,145,101,0.13)"],
    [1, "rgba(241,145,101,0)"],
  ]);
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#ffe2a4";
  context.beginPath();
  context.arc(sunX, sunY, sunRadius, 0, Math.PI * 2);
  context.fill();

  context.strokeStyle = "rgba(255,224,175,0.16)";
  context.lineWidth = Math.max(1, width * 0.002);
  for (let index = 0; index < 13; index += 1) {
    const angle = (index / 13) * Math.PI * 2 + 0.25;
    const radiusStart = width * 0.08;
    const radiusEnd = width * (0.16 + (index % 4) * 0.03);
    line(
      context,
      sunX + Math.cos(angle) * radiusStart,
      sunY + Math.sin(angle) * radiusStart,
      sunX + Math.cos(angle) * radiusEnd,
      sunY + Math.sin(angle) * radiusEnd,
    );
  }

  context.fillStyle = "#5a4147";
  context.beginPath();
  context.moveTo(0, horizon);
  context.lineTo(0, height * 0.56);
  context.bezierCurveTo(width * 0.12, height * 0.48, width * 0.25, height * 0.6, width * 0.38, height * 0.54);
  context.bezierCurveTo(width * 0.53, height * 0.47, width * 0.64, height * 0.58, width * 0.78, height * 0.53);
  context.bezierCurveTo(width * 0.9, height * 0.5, width * 0.96, height * 0.56, width, height * 0.54);
  context.lineTo(width, horizon);
  context.closePath();
  context.fill();

  context.fillStyle = "#3a3033";
  context.beginPath();
  context.moveTo(0, horizon);
  context.lineTo(0, height * 0.63);
  context.bezierCurveTo(width * 0.22, height * 0.57, width * 0.38, height * 0.64, width * 0.58, height * 0.607);
  context.bezierCurveTo(width * 0.72, height * 0.58, width * 0.84, height * 0.64, width, height * 0.602);
  context.lineTo(width, horizon);
  context.closePath();
  context.fill();

  context.fillStyle = "#16161a";
  context.beginPath();
  context.moveTo(0, horizon);
  context.lineTo(0, height * 0.68);
  context.bezierCurveTo(width * 0.25, height * 0.635, width * 0.36, height * 0.7, width * 0.51, height * 0.65);
  context.bezierCurveTo(width * 0.71, height * 0.61, width * 0.8, height * 0.68, width, height * 0.63);
  context.lineTo(width, height);
  context.lineTo(0, height);
  context.closePath();
  context.fill();

  context.fillStyle = linearGradient(context, 0, height * 0.75, 0, height, [
    [0, "#201c1d"],
    [1, "#090a0c"],
  ]);
  context.beginPath();
  context.moveTo(width * 0.42, height);
  context.bezierCurveTo(width * 0.46, height * 0.86, width * 0.47, height * 0.77, width * 0.53, height * 0.72);
  context.bezierCurveTo(width * 0.58, height * 0.78, width * 0.6, height * 0.88, width * 0.7, height);
  context.closePath();
  context.fill();
  context.strokeStyle = "rgba(246,189,125,0.24)";
  context.lineWidth = Math.max(1, width * 0.0013);
  line(context, width * 0.49, height, width * 0.49, height * 0.73);

  const carX = width * (0.42 + progress * 0.19);
  const carY = height * 0.89;
  context.fillStyle = "#111113";
  context.beginPath();
  context.roundRect(carX - width * 0.034, carY - height * 0.038, width * 0.068, height * 0.03, width * 0.01);
  context.fill();
  context.fillStyle = `${withAlpha(scene.palette[2], 0.62)}`;
  context.beginPath();
  context.arc(carX + width * 0.027, carY - height * 0.02, width * 0.004, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "rgba(255,208,133,0.12)";
  context.beginPath();
  context.ellipse(carX + width * 0.045, carY + height * 0.01, width * 0.025, height * 0.012, 0.2, 0, Math.PI * 2);
  context.fill();

  const lensX = width * 0.73;
  const lensY = height * 0.29;
  context.fillStyle = radialGradient(context, lensX, lensY, width * 0.095, [
    [0, "rgba(255,232,188,0.11)"],
    [0.48, "rgba(250,190,137,0.05)"],
    [1, "rgba(250,190,137,0)"],
  ]);
    context.fillRect(lensX - width * 0.1, lensY - width * 0.1, width * 0.2, width * 0.2);
  context.strokeStyle = "rgba(255,225,174,0.08)";
  context.lineWidth = 1;
  for (let index = 0; index < 3; index += 1) {
    context.beginPath();
    context.arc(lensX, lensY, width * (0.016 + index * 0.024), 0, Math.PI * 2);
    context.stroke();
  }

  context.strokeStyle = "rgba(34,27,29,0.72)";
  for (let index = 0; index < 4; index += 1) {
    const birdX = width * (0.22 + index * 0.047) + Math.sin(time * 0.8 + index) * width * 0.004;
    const birdY = height * (0.24 + index * 0.012);
    context.beginPath();
    context.arc(birdX, birdY, width * 0.0055, Math.PI * 1.15, Math.PI * 1.9);
    context.arc(birdX + width * 0.01, birdY, width * 0.0055, Math.PI * 1.1, Math.PI * 1.85);
    context.stroke();
  }
  drawGrain(context, width, height, 0.33);
}

const VISUAL_RENDERERS = {
  ferry: drawFerry,
  alley: drawAlley,
  rooftop: drawRooftop,
  tunnel: drawTunnel,
  signal: drawSignal,
  dawn: drawDawn,
};

export function drawSceneFrame(context, width, height, scene, localTime = 0) {
  const renderer = VISUAL_RENDERERS[scene.visual] || drawFerry;
  const camera = interpolateKeyframes(scene, localTime);
  context.save();
  context.beginPath();
  context.rect(0, 0, width, height);
  context.clip();
  context.translate(width * 0.5, height * 0.5);
  context.scale(camera.zoom, camera.zoom);
  context.translate(-width * camera.x, -height * camera.y);
  renderer(context, width, height, scene, Math.max(0, localTime));
  context.restore();
  context.save();
  const warm = "rgba(18,12,9,0.06)";
  context.fillStyle = warm;
  context.fillRect(0, 0, width, height);
  drawVignette(context, width, height, 0.38);
  drawGrain(context, width, height, 0.2);
  context.restore();
}

export function drawProgramFrame(context, width, height, project, time, layout) {
  const active = getSceneAt(layout, time);
  if (!active) {
    context.fillStyle = "#080b0e";
    context.fillRect(0, 0, width, height);
    return { active: null, localTime: 0, transitionProgress: 1 };
  }
  const localTime = getLocalTime(active, time);
  const transition = active.scene.transition;
  const previous = active.index > 0 ? layout.scenes[active.index - 1] : null;
  const hasTransition =
    previous &&
    transition.type !== "cut" &&
    transition.duration > 0 &&
    localTime < transition.duration;
  const progress = hasTransition ? clamp(localTime / transition.duration, 0, 1) : 1;

  if (hasTransition && transition.type === "dissolve") {
    drawSceneFrame(context, width, height, previous.scene, previous.duration);
    context.save();
    context.globalAlpha = progress;
    drawSceneFrame(context, width, height, active.scene, localTime);
    context.restore();
  } else if (hasTransition && transition.type === "wipe") {
    drawSceneFrame(context, width, height, previous.scene, previous.duration);
    context.save();
    context.beginPath();
    context.rect(width * (1 - progress), 0, width * progress, height);
    context.clip();
    drawSceneFrame(context, width, height, active.scene, localTime);
    context.restore();
    context.fillStyle = "rgba(244,182,67,0.35)";
    context.fillRect(width * (1 - progress) - width * 0.001, 0, width * 0.002, height);
  } else if (hasTransition && transition.type === "flash") {
    drawSceneFrame(context, width, height, active.scene, localTime);
    const flash = Math.sin(progress * Math.PI) * 0.9;
    context.fillStyle = `rgba(255,243,218,${flash})`;
    context.fillRect(0, 0, width, height);
  } else {
    drawSceneFrame(context, width, height, active.scene, localTime);
  }

  return { active, localTime, transitionProgress: progress };
}

export function hashCanvas(canvas) {
  const context = canvas.getContext("2d");
  const image = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let hash = 2166136261;
  const step = image.length > 1_500_000 ? 17 : 5;
  for (let index = 0; index < image.length; index += step) {
    hash ^= image[index];
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function drawContactThumbnail(context, width, height, scene, localTime) {
  drawSceneFrame(context, width, height, scene, localTime);
}
