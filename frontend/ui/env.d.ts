/// <reference types="vite/client" />

/**
 * Side-effect CSS imports. Vite handles these at build time; TypeScript needs
 * to be told they resolve to nothing.
 */
declare module '*.css' {
  const content: string
  export default content
}
