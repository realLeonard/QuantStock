'use client';

import { useEffect, useRef } from 'react';

interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  gold: boolean;
}

const LINK_DIST = 160;
const MOUSE_DIST = 150;

export default function NeuralBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let nodes: Node[] = [];
    let rafId = 0;
    let running = true;
    const mouse = { x: -9999, y: -9999 };
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function setup() {
      const parent = canvas!.parentElement;
      width = parent ? parent.clientWidth : window.innerWidth;
      height = parent ? parent.clientHeight : window.innerHeight;
      // dpr 上限 2，防高分屏渲染过载
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas!.width = width * dpr;
      canvas!.height = height * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      // 节点数按面积自适应，低端小屏自动减量
      const count = Math.min(110, Math.floor((width * height) / 13000));
      nodes = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.6,
        vy: (Math.random() - 0.5) * 0.6,
        r: 1.2 + Math.random() * 1.6,
        gold: Math.random() < 0.25,
      }));
    }

    function draw() {
      ctx!.clearRect(0, 0, width, height);
      for (const n of nodes) {
        n.x += n.vx;
        n.y += n.vy;
        // 出界回绕
        if (n.x < -10) n.x = width + 10;
        else if (n.x > width + 10) n.x = -10;
        if (n.y < -10) n.y = height + 10;
        else if (n.y > height + 10) n.y = -10;
        // 鼠标附近微弱吸引
        const mdx = mouse.x - n.x;
        const mdy = mouse.y - n.y;
        const mdist = Math.hypot(mdx, mdy);
        if (mdist < MOUSE_DIST && mdist > 1) {
          n.x += (mdx / mdist) * 0.3;
          n.y += (mdy / mdist) * 0.3;
        }
      }
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          const dist = Math.hypot(a.x - b.x, a.y - b.y);
          if (dist >= LINK_DIST) continue;
          // 鼠标附近连线提亮
          const nearMouse =
            Math.hypot(mouse.x - a.x, mouse.y - a.y) < MOUSE_DIST ||
            Math.hypot(mouse.x - b.x, mouse.y - b.y) < MOUSE_DIST;
          const alpha = (1 - dist / LINK_DIST) * (nearMouse ? 0.85 : 0.55);
          // 鼠标附近连线泛金色，常态电光蓝
          ctx!.strokeStyle = nearMouse
            ? `rgba(255, 210, 100, ${alpha})`
            : `rgba(170, 200, 255, ${alpha})`;
          ctx!.lineWidth = nearMouse ? 1.2 : 0.8;
          ctx!.beginPath();
          ctx!.moveTo(a.x, a.y);
          ctx!.lineTo(b.x, b.y);
          ctx!.stroke();
        }
      }
      for (const n of nodes) {
        ctx!.fillStyle = n.gold ? 'rgba(255, 210, 100, 0.95)' : 'rgba(195, 215, 255, 0.8)';
        ctx!.beginPath();
        ctx!.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx!.fill();
      }
    }

    function loop() {
      if (!running) return;
      draw();
      rafId = requestAnimationFrame(loop);
    }

    function handleResize() {
      setup();
      if (reduceMotion) draw();
    }

    function handleMouseMove(e: MouseEvent) {
      const rect = canvas!.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
    }

    function handleMouseLeave() {
      mouse.x = -9999;
      mouse.y = -9999;
    }

    function handleVisibility() {
      if (reduceMotion) return;
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(rafId);
      } else if (!running) {
        running = true;
        rafId = requestAnimationFrame(loop);
      }
    }

    setup();
    if (reduceMotion) {
      // 无障碍降级：只画一帧静态图
      draw();
    } else {
      rafId = requestAnimationFrame(loop);
    }
    window.addEventListener('resize', handleResize);
    window.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseleave', handleMouseLeave);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      running = false;
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseleave', handleMouseLeave);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  return <canvas ref={canvasRef} className="neural-canvas" aria-hidden="true" />;
}
