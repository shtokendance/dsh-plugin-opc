declare module '*.module.css' { const classes: Readonly<Record<string, string>>; export default classes }
declare module '*.css?inline' { const css: string; export default css }

declare module '*.png' { const url: string; export default url }
declare module '*.woff2' { const url: string; export default url }
