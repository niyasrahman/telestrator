import electron from "electron"
import { RefObject } from "react"
import { createSelectorHook, createState } from "@state-designer/react"
import { create } from "lodash"
import cSpline from "cardinal-spline"

interface Point {
  x: number
  y: number
}

interface Mark {
  size: number
  color: string
  eraser: boolean
  points: number[]
  strength: number
}

type Elements = {
  frame: HTMLDivElement
  currentCanvas: HTMLCanvasElement
  marksCanvas: HTMLCanvasElement
}

type Refs = { [key in keyof Elements]: RefObject<Elements[key]> }

const state = createState({
  data: {
    isFading: true,
    isDragging: false,
    fadeDelay: 0.5,
    fadeDuration: 2,
    refs: undefined as Refs | undefined,
    color: "#42a6f6",
    size: 16,
    marks: [] as Mark[],
    currentMark: undefined as Mark | undefined,
    redos: [] as Mark[],
    canvasSize: {
      width: 0,
      height: 0,
    },
  },
  on: {
    SELECTED_COLOR: "setColor",
    SELECTED_SIZE: "setSize",
  },

  states: {
    app: {
      initial: "loading",
      states: {
        loading: {
          on: {
            LOADED: [
              "setRefs",
              {
                get: "elements",
                do: ["setupCanvases", "clearCurrentCanvas", "clearMarksCanvas"],
              },
              {
                to: "ready",
              },
            ],
          },
        },
        ready: {
          initial: "inactive",
          states: {
            inactive: {
              onEnter: ["clearCurrentMark", "deactivate"],
              on: {
                ACTIVATED: { to: "active" },
                ENTERED_CONTROLS: { to: "selecting" },
              },
            },
            selecting: {
              onEnter: "activate",
              on: {
                LEFT_CONTROLS: { to: "inactive" },
                SELECTED: { to: "active" },
                STARTED_DRAWING: { to: "inactive" },
              },
            },
            active: {
              onEnter: ["activate", { get: "elements", do: "handleResize" }],
              on: {
                DEACTIVATED: { to: "inactive" },
                UNDO: {
                  get: "elements",
                  if: "hasMarks",
                  do: [
                    "undoMark",
                    "drawMarks",
                    "clearCurrentCanvas",
                    "drawCurrentMark",
                  ],
                },
                REDO: {
                  get: "elements",
                  if: "hasRedos",
                  do: [
                    "redoMark",
                    "drawMarks",
                    "clearCurrentCanvas",
                    "drawCurrentMark",
                  ],
                },
                RESIZED: {
                  get: "elements",
                  secretlyDo: ["handleResize", "drawMarks", "drawCurrentMark"],
                },
                UNLOADED: {
                  do: "clearRefs",
                  to: "loading",
                },
              },
              states: {
                tool: {
                  on: {
                    HARD_CLEARED: {
                      get: "elements",
                      do: [
                        "clearHistory",
                        "clearCurrentMark",
                        "clearCurrentCanvas",
                        "clearMarksCanvas",
                      ],
                      to: ["pencil", "inactive"],
                    },
                    MEDIUM_CLEARED: {
                      get: "elements",
                      do: [
                        "clearHistory",
                        "clearCurrentMark",
                        "clearCurrentCanvas",
                        "clearMarksCanvas",
                      ],
                      to: ["pencil", "selecting"],
                    },
                    SOFT_CLEARED: {
                      get: "elements",
                      do: [
                        "clearHistory",
                        "clearCurrentMark",
                        "clearCurrentCanvas",
                        "clearMarksCanvas",
                      ],
                      to: ["pencil"],
                    },
                  },
                  initial: "pencil",
                  states: {
                    pencil: {
                      on: {
                        STARTED_DRAWING: {
                          get: "elements",
                          do: ["beginPencilMark", "drawCurrentMark"],
                        },
                        SELECTED_ERASER: { to: "eraser" },
                      },
                    },
                    eraser: {
                      on: {
                        STARTED_DRAWING: {
                          get: "elements",
                          secretlyDo: ["beginEraserMark", "drawCurrentMark"],
                        },
                        SELECTED_COLOR: { to: "pencil" },
                        SELECTED_PENCIL: { to: "pencil" },
                      },
                    },
                  },
                },
                frame: {
                  initial: "fixed",
                  states: {
                    fixed: {
                      on: {
                        STARTED_DRAGGING: { to: "dragging" },
                      },
                    },
                    dragging: {
                      on: {
                        STOPPED_DRAGGING: { to: "fixed" },
                      },
                    },
                  },
                },
                canvas: {
                  initial: "notDrawing",
                  states: {
                    notDrawing: {
                      on: {
                        STARTED_DRAWING: { to: "drawing" },
                      },
                    },
                    drawing: {
                      onEnter: "clearRedos",
                      on: {
                        STOPPED_DRAWING: {
                          get: "elements",
                          do: [
                            "completeMark",
                            "clearCurrentMark",
                            "clearCurrentCanvas",
                            "drawMarks",
                          ],
                          to: ["notDrawing", "hasMarks"],
                        },
                        MOVED_CURSOR: {
                          get: "elements",
                          secretlyDo: ["addPointToMark", "drawCurrentMark"],
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    marks: {
      initial: "noMarks",
      states: {
        notFading: {},
        noMarks: {},
        hasMarks: {
          onEnter: {
            unless: "fadingEnabled",
            to: "notFading",
          },
          repeat: {
            onRepeat: [
              {
                unless: "hasMarks",
                secretlyTo: "noMarks",
              },
              {
                get: "elements",
                secretlyDo: [
                  "fadeMarks",
                  "removeFadedMarks",
                  "clearMarksCanvas",
                  "drawMarks",
                ],
              },
            ],
          },
        },
      },
    },
  },
  results: {
    elements(data) {
      return {
        frame: data.refs.frame.current,
        currentCanvas: data.refs.currentCanvas.current,
        marksCanvas: data.refs.marksCanvas.current,
      }
    },
  },
  conditions: {
    fadingEnabled(data) {
      return data.isFading
    },
    hasMarks(data) {
      return data.marks.length > 0
    },
    hasRedos(data) {
      return data.redos.length > 0
    },
  },
  actions: {
    // Fading
    fadeMarks(data) {
      const { fadeDuration } = data
      const delta = 0.016 / fadeDuration
      for (let mark of data.marks) {
        mark.strength -= delta
      }
    },
    removeFadedMarks(data) {
      data.marks = data.marks.filter((mark) => mark.strength > 0)
    },
    // Setup
    clearRefs(data) {
      data.refs = undefined
    },
    setRefs(data, payload: Refs) {
      data.refs = payload
    },
    activate() {
      const mainWindow = electron.remote.getCurrentWindow()
      mainWindow.maximize()
      mainWindow.setIgnoreMouseEvents(false, { forward: false })
    },
    deactivate() {
      const mainWindow = electron.remote.getCurrentWindow()
      mainWindow.setIgnoreMouseEvents(true, { forward: true })
    },
    setupCanvases(data, payload, elements: Elements) {
      {
        const cvs = elements.currentCanvas
        const ctx = cvs.getContext("2d")
        ctx.lineCap = "round"
        ctx.lineJoin = "round"
        ctx.globalCompositeOperation = "source-over"
      }
      {
        const cvs = elements.marksCanvas
        const ctx = cvs.getContext("2d")
        ctx.lineCap = "round"
        ctx.lineJoin = "round"
      }
    },
    clearHistory(data, payload, elements: Elements) {
      data.marks = []
    },
    handleResize(data, payload, elements: Elements) {
      data.canvasSize = {
        width: elements.frame.offsetWidth,
        height: elements.frame.offsetHeight,
      }

      elements.marksCanvas.width = data.canvasSize.width
      elements.marksCanvas.height = data.canvasSize.height
      elements.currentCanvas.width = data.canvasSize.width
      elements.currentCanvas.height = data.canvasSize.height
    },
    setColor(data, payload) {
      data.color = payload
    },
    setSize(data, payload) {
      data.size = payload
    },
    clearCurrentMark(data) {
      data.currentMark = undefined
    },
    clearCurrentCanvas(data, payload, elements: Elements) {
      const cvs = elements.currentCanvas
      const ctx = cvs.getContext("2d")
      ctx.clearRect(0, 0, cvs.width, cvs.height)
    },
    clearMarksCanvas(data, payload, elements: Elements) {
      const cvs = elements.marksCanvas
      const ctx = cvs.getContext("2d")
      ctx.clearRect(0, 0, cvs.width, cvs.height)
    },
    drawMarks(data, payload, elements: Elements) {
      // First clear the top canvas...
      const cvs = elements.marksCanvas
      const ctx = cvs.getContext("2d")

      if (ctx) {
        ctx.clearRect(0, 0, cvs.width, cvs.height)
        ctx.lineCap = "round"
        ctx.lineJoin = "round"
        ctx.globalCompositeOperation = "source-over"

        ctx.save()

        for (let mark of data.marks) {
          drawMark(ctx, mark, "history")
        }
      }
    },
    beginPencilMark(data, payload) {
      const { x, y } = payload
      data.currentMark = {
        size: data.size,
        color: data.color,
        strength: 1 + data.fadeDelay,
        eraser: false,
        points: [x, y, x, y, x, y, x, y],
      }
    },
    beginEraserMark(data, payload) {
      const { x, y } = payload
      data.currentMark = {
        size: data.size,
        color: data.color,
        eraser: true,
        strength: 1 + data.fadeDelay,
        points: [x, y, x, y, x, y, x, y],
      }
    },
    drawCurrentMark(data, payload, elements: Elements) {
      const cvs = elements.currentCanvas
      const ctx = cvs.getContext("2d")
      ctx.globalCompositeOperation = "source-over"

      ctx.save()

      if (ctx) {
        ctx.clearRect(0, 0, cvs.width, cvs.height)
        ctx.lineCap = "round"
        ctx.lineJoin = "round"

        // Draw current mark to the top canvas
        if (data.currentMark !== undefined) {
          drawMark(ctx, data.currentMark, "current")
        }
      }
    },
    completeMark(data) {
      data.currentMark.points = cSpline(data.currentMark.points)
      data.marks.push(data.currentMark)
    },
    addPointToMark(data, payload) {
      const { x, y } = payload
      data.currentMark.points.push(x, y)
    },
    undoMark(data) {
      data.redos.push(data.marks.pop())
    },
    redoMark(data) {
      data.marks.push(data.redos.pop())
    },
    clearRedos(data) {
      data.redos = []
    },
  },
})

// Draw a mark onto the given canvas
function drawMark(
  ctx: CanvasRenderingContext2D,
  mark: Mark,
  layer: "current" | "history"
) {
  ctx.beginPath()
  ctx.lineWidth = mark.size
  ctx.strokeStyle = mark.color
  ctx.globalAlpha = easeOutQuad(Math.min(1, mark.strength))
  ctx.globalCompositeOperation = "source-over"

  const pts = layer === "current" ? cSpline(mark.points) : mark.points

  const [x, y, ...rest] = pts

  ctx.moveTo(x, y)

  for (let i = 0; i < rest.length - 1; i += 2) {
    ctx.lineTo(rest[i], rest[i + 1])
  }

  if (mark.eraser) {
    if (layer !== "current") {
      ctx.globalCompositeOperation = "destination-out"
    }
    ctx.strokeStyle = `rgba(144, 144, 144, .9)`
  }

  ctx.stroke()
  ctx.restore()
}

// state.onUpdate((update) => console.log(update.active, update.log[0]))

export const useSelector = createSelectorHook(state)
export default state

const easeOutQuad = (t: number) => t * (2 - t)
