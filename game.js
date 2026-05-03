/** @type {HTMLCanvasElement} */
const canvas = document.getElementById('game')
const game = canvas.getContext('2d')
const buttonUp = document.getElementById('up')
const buttonLeft = document.getElementById('left')
const buttonRight = document.getElementById('right')
const buttonDown = document.getElementById('down')
const levelDisplay = document.getElementById('level-display')
const livesDisplay = document.getElementById('lives-display')
const riskDisplay = document.getElementById('risk-display')
const levelTimeDisplay = document.getElementById('level-time-display')
const bestTimeDisplay = document.getElementById('best-time-display')
const totalTimeDisplay = document.getElementById('total-time-display')
const resetProgressButton = document.getElementById('reset-progress')
const summaryPanel = document.getElementById('summary-panel')
const summaryText = document.getElementById('summary-text')

const STORAGE_KEY = 'laberinto-game-state'
const STORAGE_VERSION = 3
const BASE_GENERATED_MAP_SIZE = 10
const MAX_GENERATED_MAP_SIZE = 16
const MAX_LIVES = 5
const MAP_GENERATION_ATTEMPTS = 20
const INPUT_REPEAT_DELAY = 140
const INPUT_REPEAT_INTERVAL = 85
const TIMER_UPDATE_INTERVAL = 200

let canvasSize
let elementSize
let currentLevel = 0
let map = ''
let lives = MAX_LIVES
let generatedLevels = {}
let currentMovingBombs = []
let activeMovementKey = ''
let pressedMovementKeys = []
let movementTimeoutId = null
let movementIntervalId = null
let timerIntervalId = null
let totalElapsedOffsetMs = 0
let levelElapsedOffsetMs = 0
let totalTimerStartedAt = 0
let levelTimerStartedAt = 0
let bestLevelTimes = {}
let completedLevels = []
let gameOver = false

const startPosition = { row: 0, column: 0 }
const playerPosition = { row: 0, column: 0 }
const giftPosition = { row: 0, column: 0 }

const emojis = {
  '-': ' ',
  O: '🚪',
  X: '💣',
  I: '🎁',
  PLAYER: '💀',
  BOMB_COLLISION: '🔥',
  HEART: '❤',
}

window.addEventListener('load', startGame)
window.addEventListener('resize', setCanvasSize)
window.addEventListener('keydown', moveByKeyboard)
window.addEventListener('keyup', stopKeyboardMovement)
window.addEventListener('blur', () => clearMovementLoop(true))
window.addEventListener('beforeunload', saveGameState)
buttonUp.addEventListener('click', moveUp)
buttonLeft.addEventListener('click', moveLeft)
buttonRight.addEventListener('click', moveRight)
buttonDown.addEventListener('click', moveDown)
resetProgressButton.addEventListener('click', resetStoredProgress)

function startGame() {
  restoreGameState()
  totalTimerStartedAt = Date.now()
  loadLevel({ preserveLevelTime: true })
  startTimerLoop()
}

function setCanvasSize() {
  const availableWidth = window.innerWidth - 32
  const availableHeight = window.innerHeight * 0.55
  const maxCanvasSize = Math.min(availableWidth, availableHeight, 500)

  canvasSize = Math.max(Math.floor(maxCanvasSize), 220)
  elementSize = canvasSize / getMapSize()

  canvas.style.width = `${canvasSize}px`
  canvas.style.height = `${canvasSize}px`

  const pixelRatio = window.devicePixelRatio || 1
  canvas.width = Math.floor(canvasSize * pixelRatio)
  canvas.height = Math.floor(canvasSize * pixelRatio)
  game.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
  game.imageSmoothingEnabled = false

  renderGame()
}

function getMapSize() {
  const rows = mapRowsFromMap()
  return rows.length
}

function renderGame() {
  game.clearRect(0, 0, canvasSize, canvasSize)
  game.font = `${elementSize}px Verdana`
  game.textAlign = 'center'
  game.textBaseline = 'middle'

  const mapRows = mapRowsFromMap()
  mapRows.forEach((row, rowIndex) => {
    row.split('').forEach((symbol, columnIndex) => {
      const posX = elementSize * (columnIndex + 0.5)
      const posY = elementSize * (rowIndex + 0.5)
      game.fillText(emojis[symbol], posX, posY)
    })
  })

  currentMovingBombs.forEach((bomb) => {
    const posX = elementSize * (bomb.column + 0.5)
    const posY = elementSize * (bomb.row + 0.5)
    game.fillText(emojis.BOMB_COLLISION, posX, posY)
  })

  const playerX = elementSize * (playerPosition.column + 0.5)
  const playerY = elementSize * (playerPosition.row + 0.5)
  game.fillText(emojis.PLAYER, playerX, playerY)
  updateHUD()
  saveGameState()
}

function mapRowsFromMap() {
  return map.trim().split('\n').map((row) => row.trim())
}

function setPositions() {
  const rows = mapRowsFromMap()
  rows.forEach((row, rowIndex) => {
    row.split('').forEach((symbol, columnIndex) => {
      if (symbol === 'O') {
        startPosition.row = rowIndex
        startPosition.column = columnIndex
        playerPosition.row = rowIndex
        playerPosition.column = columnIndex
      }
      if (symbol === 'I') {
        giftPosition.row = rowIndex
        giftPosition.column = columnIndex
      }
    })
  })
}

function loadLevel(options = {}) {
  const { preserveLevelTime = false } = options
  const levelData = getLevelData(currentLevel)
  map = levelData.map
  currentMovingBombs = cloneMovingBombs(levelData.movingBombs || [])
  levelElapsedOffsetMs = preserveLevelTime ? levelElapsedOffsetMs : 0
  levelTimerStartedAt = Date.now()
  gameOver = false
  hideSummary()
  setPositions()
  setCanvasSize()
}

function moveUp() { movePlayer(-1, 0) }
function moveLeft() { movePlayer(0, -1) }
function moveRight() { movePlayer(0, 1) }
function moveDown() { movePlayer(1, 0) }

function movePlayer(rowChange, columnChange) {
  if (gameOver) return

  const nextRow = playerPosition.row + rowChange
  const nextColumn = playerPosition.column + columnChange
  const mapLimit = getMapSize() - 1

  if (nextRow < 0 || nextRow > mapLimit || nextColumn < 0 || nextColumn > mapLimit) return

  if (getCell(nextRow, nextColumn) === 'X') {
    handleBombCollision()
    return
  }

  playerPosition.row = nextRow
  playerPosition.column = nextColumn

  if (isPlayerOnMovingBomb()) {
    handleBombCollision('Una bomba movil te alcanzo.')
    return
  }

  if (playerPosition.row === giftPosition.row && playerPosition.column === giftPosition.column) {
    goToNextLevel()
    return
  }

  moveMovingBombs()
  if (isPlayerOnMovingBomb()) {
    handleBombCollision('Una bomba movil te alcanzo.')
    return
  }
  renderGame()
}

function getCell(row, column) {
  return mapRowsFromMap()[row][column]
}

function goToNextLevel() {
  const completedLevel = currentLevel
  const completedLevelNumber = completedLevel + 1
  const config = getGeneratedLevelConfig(completedLevel)
  const elapsed = getCurrentLevelElapsedMs()

  registerCompletedLevel(completedLevel, config, elapsed)
  updateBestLevelTime(completedLevel, elapsed)

  if (completedLevelNumber % 10 === 0 || config.difficultyLabel === 'extrema') {
    lives = Math.min(lives + 1, MAX_LIVES)
  }

  currentLevel += 1
  loadLevel()
}

function handleBombCollision(cause = '') {
  lives -= 1
  if (lives <= 0) {
    finishGame(cause || 'Te quedaste sin vidas.')
    return
  }
  playerPosition.row = startPosition.row
  playerPosition.column = startPosition.column
  resetMovingBombs()
  renderGame()
}

function finishGame(causeMessage = '') {
  gameOver = true
  clearMovementLoop(true)
  clearTimerLoop()
  updateHUD()
  renderGame()
  showSummary(causeMessage)
}

function resetStoredProgress() {
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch (error) {
    console.error('No se pudo limpiar el progreso.', error)
  }
  clearMovementLoop(true)
  clearTimerLoop()
  setDefaultState()
  totalTimerStartedAt = Date.now()
  loadLevel()
  startTimerLoop()
}

function updateHUD() {
  levelDisplay.textContent = `${currentLevel + 1}`
  livesDisplay.textContent = emojis.HEART.repeat(lives)
  riskDisplay.textContent = getRiskLabel()
  levelTimeDisplay.textContent = formatTime(getCurrentLevelElapsedMs())
  totalTimeDisplay.textContent = formatTime(getCurrentTotalElapsedMs())
  bestTimeDisplay.textContent = getBestTimeLabel()
}

function getRiskLabel() {
  if (currentLevel < maps.length) return 'Bajo'
  const label = getGeneratedLevelConfig(currentLevel).riskLabel
  return label.charAt(0).toUpperCase() + label.slice(1)
}

function moveByKeyboard(event) {
  const actions = getMovementActions()
  if (!actions[event.key]) return
  event.preventDefault()

  pressedMovementKeys = pressedMovementKeys.filter((key) => key !== event.key)
  pressedMovementKeys.push(event.key)

  if (activeMovementKey === event.key) return

  const hadActive = Boolean(activeMovementKey || movementTimeoutId || movementIntervalId)
  clearMovementLoop()
  activeMovementKey = event.key
  actions[event.key]()

  if (hadActive) {
    startMovementInterval(actions)
    return
  }

  movementTimeoutId = window.setTimeout(() => {
    startMovementInterval(actions)
  }, INPUT_REPEAT_DELAY)
}

function stopKeyboardMovement(event) {
  pressedMovementKeys = pressedMovementKeys.filter((key) => key !== event.key)
  if (event.key !== activeMovementKey) return

  const nextKey = pressedMovementKeys[pressedMovementKeys.length - 1]
  if (nextKey) {
    activeMovementKey = nextKey
    const action = getMovementActions()[nextKey]
    if (action) action()
    startMovementInterval()
    return
  }
  clearMovementLoop()
}

function clearMovementLoop(resetPressedKeys = false) {
  if (movementTimeoutId) {
    window.clearTimeout(movementTimeoutId)
    movementTimeoutId = null
  }
  if (movementIntervalId) {
    window.clearInterval(movementIntervalId)
    movementIntervalId = null
  }
  activeMovementKey = ''
  if (resetPressedKeys) pressedMovementKeys = []
}

function startMovementInterval(actions = getMovementActions()) {
  if (movementIntervalId) window.clearInterval(movementIntervalId)
  movementIntervalId = window.setInterval(() => {
    const action = actions[activeMovementKey]
    if (!action) {
      clearMovementLoop()
      return
    }
    action()
  }, INPUT_REPEAT_INTERVAL)
}

function getMovementActions() {
  return {
    ArrowUp: moveUp,
    ArrowLeft: moveLeft,
    ArrowRight: moveRight,
    ArrowDown: moveDown,
  }
}

function startTimerLoop() {
  clearTimerLoop()
  timerIntervalId = window.setInterval(updateHUD, TIMER_UPDATE_INTERVAL)
}

function clearTimerLoop() {
  if (timerIntervalId) {
    window.clearInterval(timerIntervalId)
    timerIntervalId = null
  }
}

function getCurrentTotalElapsedMs() {
  if (!totalTimerStartedAt) return totalElapsedOffsetMs
  return totalElapsedOffsetMs + (Date.now() - totalTimerStartedAt)
}

function getCurrentLevelElapsedMs() {
  if (!levelTimerStartedAt) return levelElapsedOffsetMs
  return levelElapsedOffsetMs + (Date.now() - levelTimerStartedAt)
}

function formatTime(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function getBestTimeLabel() {
  const best = bestLevelTimes[currentLevel]
  return Number.isFinite(best) ? formatTime(best) : '--:--'
}

function updateBestLevelTime(levelIndex, elapsedMs) {
  const previous = bestLevelTimes[levelIndex]
  if (!Number.isFinite(previous) || elapsedMs < previous) bestLevelTimes[levelIndex] = elapsedMs
}

function registerCompletedLevel(levelIndex, levelConfig, elapsedMs) {
  completedLevels.push({
    levelNumber: levelIndex + 1,
    difficulty: normalizeDifficultyLabel(levelConfig.difficultyLabel),
    timeMs: elapsedMs,
  })
}

function normalizeDifficultyLabel(label) {
  if (label === 'extrema') return 'extremo'
  if (label === 'alta') return 'dificil'
  return 'estandar'
}

function showSummary(causeMessage = '') {
  const totals = completedLevels.reduce((acc, level) => {
    acc[level.difficulty] += 1
    return acc
  }, { estandar: 0, dificil: 0, extremo: 0 })

  summaryText.textContent = [
    causeMessage || 'Partida terminada.',
    `Tiempo total: ${formatTime(getCurrentTotalElapsedMs())}.`,
    `Niveles superados: ${completedLevels.length}.`,
    `Estandar: ${totals.estandar}.`,
    `Dificiles: ${totals.dificil}.`,
    `Extremos: ${totals.extremo}.`,
  ].join(' ')
  summaryPanel.hidden = false
}

function hideSummary() {
  summaryPanel.hidden = true
}

function saveGameState() {
  try {
    const state = {
      version: STORAGE_VERSION,
      currentLevel,
      lives,
      generatedLevels,
      totalElapsedMs: getCurrentTotalElapsedMs(),
      levelElapsedMs: getCurrentLevelElapsedMs(),
      bestLevelTimes,
      completedLevels,
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch (error) {
    console.error('No se pudo guardar el progreso.', error)
  }
}

function restoreGameState() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (!stored) {
      setDefaultState()
      return
    }
    const parsed = JSON.parse(stored)
    if (parsed.version !== STORAGE_VERSION) {
      setDefaultState()
      return
    }

    currentLevel = Number.isInteger(parsed.currentLevel) ? Math.max(parsed.currentLevel, 0) : 0
    lives = Number.isInteger(parsed.lives) ? Math.min(Math.max(parsed.lives, 1), MAX_LIVES) : MAX_LIVES
    totalElapsedOffsetMs = Number.isFinite(parsed.totalElapsedMs) ? Math.max(parsed.totalElapsedMs, 0) : 0
    levelElapsedOffsetMs = Number.isFinite(parsed.levelElapsedMs) ? Math.max(parsed.levelElapsedMs, 0) : 0
    generatedLevels = isValidGeneratedLevels(parsed.generatedLevels) ? parsed.generatedLevels : {}
    bestLevelTimes = isValidBestLevelTimes(parsed.bestLevelTimes) ? parsed.bestLevelTimes : {}
    completedLevels = isValidCompletedLevels(parsed.completedLevels) ? parsed.completedLevels : []
  } catch (error) {
    console.error('No se pudo recuperar el progreso.', error)
    setDefaultState()
  }
}

function setDefaultState() {
  lives = MAX_LIVES
  currentLevel = 0
  generatedLevels = {}
  currentMovingBombs = []
  pressedMovementKeys = []
  bestLevelTimes = {}
  completedLevels = []
  totalElapsedOffsetMs = 0
  levelElapsedOffsetMs = 0
  gameOver = false
}

function getLevelData(levelIndex) {
  if (maps[levelIndex]) return { map: maps[levelIndex], movingBombs: [] }
  if (!generatedLevels[levelIndex]) generatedLevels[levelIndex] = generateRandomLevel(levelIndex)
  return generatedLevels[levelIndex]
}

function generateRandomLevel(levelIndex) {
  let best = null
  let bestScore = -1

  for (let attempt = 0; attempt < MAP_GENERATION_ATTEMPTS; attempt += 1) {
    const candidate = buildGeneratedLevel(levelIndex)
    const score = getLevelPlayabilityScore(candidate)
    if (isLevelPlayable(candidate)) return candidate
    if (score > bestScore) {
      best = candidate
      bestScore = score
    }
  }
  return best || buildGeneratedLevel(levelIndex)
}

function buildGeneratedLevel(levelIndex) {
  const config = getGeneratedLevelConfig(levelIndex)
  const grid = Array.from({ length: config.size }, () => Array(config.size).fill('X'))
  const path = buildGuaranteedPath(config.size)

  path.forEach(({ row, column }, index) => {
    if (index === 0) grid[row][column] = 'O'
    else if (index === path.length - 1) grid[row][column] = 'I'
    else grid[row][column] = '-'
  })

  openCellsNearPath(grid, path, config.pathBufferRadius)
  openRandomCells(grid, Math.min(config.extraSafeCells, grid.length * grid.length - path.length - 2))
  const analysis = analyzeGeneratedMap(grid.map((row) => row.join('')))

  return {
    map: grid.map((row) => row.join('')).join('\n'),
    movingBombs: createMovingBombs(grid, path, analysis, config.movingBombCount),
  }
}

function getGeneratedLevelConfig(levelIndex) {
  if (levelIndex < maps.length) {
    return { size: BASE_GENERATED_MAP_SIZE, extraSafeCells: 14, movingBombCount: 0, pathBufferRadius: 1, riskLabel: 'bajo', difficultyLabel: 'base' }
  }

  const generatedLevel = levelIndex - maps.length + 1
  const sizeIncrease = Math.floor(generatedLevel / 3)
  const size = Math.min(BASE_GENERATED_MAP_SIZE + sizeIncrease, MAX_GENERATED_MAP_SIZE)
  const safeCellReduction = Math.floor(generatedLevel / 3)

  return {
    size,
    extraSafeCells: Math.max(10, 18 - safeCellReduction),
    movingBombCount: Math.min(1 + Math.floor(generatedLevel / 6), 2),
    pathBufferRadius: 1,
    riskLabel: generatedLevel < 4 ? 'medio' : generatedLevel < 8 ? 'alto' : 'extremo',
    difficultyLabel: generatedLevel < 4 ? 'media' : generatedLevel < 8 ? 'alta' : 'extrema',
  }
}

function buildGuaranteedPath(size) {
  const start = { row: size - 1, column: 0 }
  const target = { row: 0, column: size - 1 }
  const path = [{ ...start }]
  let current = { ...start }

  while (current.row !== target.row || current.column !== target.column) {
    const possible = []
    if (current.row > target.row) possible.push({ row: current.row - 1, column: current.column })
    if (current.column < target.column) possible.push({ row: current.row, column: current.column + 1 })
    if (current.row < size - 1 && Math.random() > 0.72) possible.push({ row: current.row + 1, column: current.column })
    if (current.column > 0 && Math.random() > 0.72) possible.push({ row: current.row, column: current.column - 1 })

    shuffleArray(possible)
    const next = possible.find((step) => !path.some((p) => p.row === step.row && p.column === step.column)) || getCloserStep(current, target)
    current = next
    path.push({ ...current })
  }

  return path
}

function getCloserStep(current, target) {
  if (current.row > target.row) return { row: current.row - 1, column: current.column }
  return { row: current.row, column: current.column + 1 }
}

function openRandomCells(grid, amount) {
  const candidates = []
  grid.forEach((row, rowIndex) => row.forEach((cell, columnIndex) => {
    if (cell === 'X') candidates.push({ row: rowIndex, column: columnIndex })
  }))
  shuffleArray(candidates)
  candidates.slice(0, amount).forEach(({ row, column }) => { grid[row][column] = '-' })
}

function openCellsNearPath(grid, path, radius) {
  if (radius <= 0) return
  path.forEach(({ row, column }) => {
    for (let r = -radius; r <= radius; r += 1) {
      for (let c = -radius; c <= radius; c += 1) {
        const nextRow = row + r
        const nextColumn = column + c
        if (!grid[nextRow] || grid[nextRow][nextColumn] === undefined) continue
        if (grid[nextRow][nextColumn] === 'X') grid[nextRow][nextColumn] = '-'
      }
    }
  })
}

function createMovingBombs(grid, path, analysis, amount) {
  const candidates = []
  const protectedCells = new Set(path.flatMap(({ row, column }) => {
    const cells = []
    for (let r = -1; r <= 1; r += 1) {
      for (let c = -1; c <= 1; c += 1) cells.push(`${row + r}-${column + c}`)
    }
    return cells
  }))

  grid.forEach((row, rowIndex) => row.forEach((cell, columnIndex) => {
    const key = `${rowIndex}-${columnIndex}`
    if (
      cell === '-' &&
      !(rowIndex === grid.length - 1 && columnIndex === 0) &&
      !protectedCells.has(key) &&
      analysis.visitedKeys.has(key) &&
      countWalkableNeighborsFromRows(grid, rowIndex, columnIndex) >= 2
    ) {
      candidates.push({ row: rowIndex, column: columnIndex })
    }
  }))

  shuffleArray(candidates)
  return candidates.slice(0, amount)
}

function isLevelPlayable(levelData) {
  const rows = levelData.map.split('\n')
  const analysis = analyzeGeneratedMap(rows)
  if (!analysis.start || !analysis.gift) return false

  const totalCells = rows.length * rows.length
  const reachableRatio = analysis.reachableCount / totalCells
  const minRatio = rows.length >= 13 ? 0.36 : 0.42
  const minBranching = Math.max(10, Math.floor(rows.length * 1.2))
  const nearStartBombs = levelData.movingBombs.filter((bomb) => getManhattanDistance(bomb, analysis.start) <= 3).length

  return analysis.giftReachable && reachableRatio >= minRatio && analysis.branchingCount >= minBranching && nearStartBombs === 0
}

function getLevelPlayabilityScore(levelData) {
  const rows = levelData.map.split('\n')
  const analysis = analyzeGeneratedMap(rows)
  const totalCells = rows.length * rows.length
  const reachableRatio = totalCells ? analysis.reachableCount / totalCells : 0
  return (analysis.giftReachable ? 1000 : 0) + Math.floor(reachableRatio * 100) + analysis.branchingCount * 2 - levelData.movingBombs.length * 8
}

function analyzeGeneratedMap(mapRows) {
  const rows = Array.isArray(mapRows) ? mapRows : mapRows.split('\n')
  let start = null
  let gift = null

  rows.forEach((row, rowIndex) => row.split('').forEach((symbol, columnIndex) => {
    if (symbol === 'O') start = { row: rowIndex, column: columnIndex }
    if (symbol === 'I') gift = { row: rowIndex, column: columnIndex }
  }))

  if (!start || !gift) return { start, gift, reachableCount: 0, giftReachable: false, branchingCount: 0, visitedKeys: new Set() }

  const queue = [start]
  const visited = new Set([`${start.row}-${start.column}`])
  let branchingCount = 0

  while (queue.length) {
    const current = queue.shift()
    const next = [
      { row: current.row - 1, column: current.column },
      { row: current.row + 1, column: current.column },
      { row: current.row, column: current.column - 1 },
      { row: current.row, column: current.column + 1 },
    ]

    next.forEach((position) => {
      const key = `${position.row}-${position.column}`
      if (visited.has(key) || !canStepOnGeneratedMap(rows, position.row, position.column)) return
      visited.add(key)
      queue.push(position)
    })

    if (countWalkableNeighborsFromRows(rows, current.row, current.column) >= 3) branchingCount += 1
  }

  return {
    start,
    gift,
    reachableCount: visited.size,
    giftReachable: visited.has(`${gift.row}-${gift.column}`),
    branchingCount,
    visitedKeys: visited,
  }
}

function canStepOnGeneratedMap(rows, row, column) {
  const rowExists = rows[row]
  if (!rowExists || rowExists[column] === undefined) return false
  const cell = rowExists[column]
  return cell === '-' || cell === 'O' || cell === 'I'
}

function moveMovingBombs() {
  if (!currentMovingBombs.length) return
  const occupied = new Set()
  currentMovingBombs = currentMovingBombs.map((bomb) => {
    const next = getNextMovingBombPosition(bomb, occupied)
    occupied.add(`${next.row}-${next.column}`)
    return next
  })
}

function getNextMovingBombPosition(bomb, occupied) {
  const possibleMoves = getValidMovingBombSteps(bomb, occupied)
  if (!possibleMoves.length) return bomb
  shuffleArray(possibleMoves)
  return possibleMoves[0]
}

function getValidMovingBombSteps(bomb, occupied) {
  const positions = [
    { row: bomb.row - 1, column: bomb.column },
    { row: bomb.row + 1, column: bomb.column },
    { row: bomb.row, column: bomb.column - 1 },
    { row: bomb.row, column: bomb.column + 1 },
    bomb,
  ]
  return positions.filter((position) => !occupied.has(`${position.row}-${position.column}`) && canMovingBombStepOn(position.row, position.column))
}

function canMovingBombStepOn(row, column) {
  const rows = mapRowsFromMap()
  if (!rows[row] || rows[row][column] === undefined) return false
  const cell = rows[row][column]
  return cell === '-' || cell === 'O' || cell === 'I'
}

function countWalkableNeighborsFromRows(rows, row, column) {
  const next = [
    { row: row - 1, column },
    { row: row + 1, column },
    { row, column: column - 1 },
    { row, column: column + 1 },
  ]
  return next.filter((position) => {
    const rowExists = rows[position.row]
    if (!rowExists || rowExists[position.column] === undefined) return false
    const cell = rowExists[position.column]
    return cell === '-' || cell === 'O' || cell === 'I'
  }).length
}

function isPlayerOnMovingBomb() {
  return currentMovingBombs.some((bomb) => bomb.row === playerPosition.row && bomb.column === playerPosition.column)
}

function resetMovingBombs() {
  currentMovingBombs = cloneMovingBombs(getLevelData(currentLevel).movingBombs || [])
}

function cloneMovingBombs(movingBombs) {
  return movingBombs.map((bomb) => ({ ...bomb }))
}

function getManhattanDistance(positionA, positionB) {
  return Math.abs(positionA.row - positionB.row) + Math.abs(positionA.column - positionB.column)
}

function shuffleArray(items) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1))
    const temp = items[index]
    items[index] = items[randomIndex]
    items[randomIndex] = temp
  }
}

function isValidGeneratedLevels(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.values(value).every((levelData) => {
    if (!levelData || typeof levelData !== 'object' || Array.isArray(levelData)) return false
    if (typeof levelData.map !== 'string' || !Array.isArray(levelData.movingBombs)) return false
    return levelData.movingBombs.every((bomb) => bomb && Number.isInteger(bomb.row) && Number.isInteger(bomb.column))
  })
}

function isValidBestLevelTimes(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.values(value).every((time) => Number.isFinite(time) && time >= 0)
}

function isValidCompletedLevels(value) {
  if (!Array.isArray(value)) return false
  return value.every((level) => {
    if (!level || typeof level !== 'object' || Array.isArray(level)) return false
    if (!Number.isInteger(level.levelNumber) || level.levelNumber <= 0) return false
    if (!['estandar', 'dificil', 'extremo'].includes(level.difficulty)) return false
    return Number.isFinite(level.timeMs) && level.timeMs >= 0
  })
}
