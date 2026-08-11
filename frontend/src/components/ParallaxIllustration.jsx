import { useEffect, useRef } from 'react'
import cherryBlossomSvg from '../assets/cherry-blossom.svg?raw'

// 离视角越"近"的层，鼠标移动时位移幅度越大。这里的数值单位是SVG自己内部的坐标空间
// （viewBox="0 0 500 500"），不是屏幕CSS像素——因为用的是SVG原生 transform 属性
// （setAttribute），不是CSS的 style.transform（后者在SVG元素上有坐标系歧义，
// 容易出现"设置了但视觉上几乎没反应"的问题）。按SVG里四个顶层 <g> 出现的固定顺序
// （background / Clouds / Flowers / cherry-blossom）取
const LAYER_DEPTH = [12, 24, 42, 65]

export default function ParallaxIllustration({ className = '' }) {
  const containerRef = useRef(null)

  useEffect(() => {
    const container = containerRef.current
    const svg = container?.querySelector('svg')
    if (!svg) return

    const groups = Array.from(svg.children).filter((el) => el.tagName === 'g')
    const layers = groups.map((el, i) => [el, LAYER_DEPTH[i] ?? 20])

    // 归一化用整个浏览器窗口的宽高，不是这个小容器自己的宽高——只要鼠标不在这一小块
    // 范围内，拿容器自己的宽高去除会得到远超 -0.5~0.5 的比例，图形被甩出可视范围
    function onMouseMove(e) {
      const nx = e.clientX / window.innerWidth - 0.5
      const ny = e.clientY / window.innerHeight - 0.5
      layers.forEach(([el, depth]) => {
        el.setAttribute('transform', `translate(${nx * depth} ${ny * depth})`)
      })
    }

    window.addEventListener('mousemove', onMouseMove)
    return () => window.removeEventListener('mousemove', onMouseMove)
  }, [])

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className={`pointer-events-none ${className}`}
      dangerouslySetInnerHTML={{ __html: cherryBlossomSvg }}
    />
  )
}
