import { describe, expect, it } from 'vitest'
import type OBSWebSocket from 'obs-websocket-js'
import {
  buildProgramOutputUrl,
  OBSClient,
  TKO_PROGRAM_SCENE,
  TKO_PROGRAM_SOURCE,
} from './obs'

type Handler = (event: any) => void

class FakeOBSSocket {
  handlers = new Map<string, Handler[]>()
  connectCount = 0
  currentScene = 'Gameplay'
  scenes = [{ sceneName: 'Gameplay', sceneIndex: 0 }]
  inputs: Array<{ inputName: string; inputKind: string; settings: Record<string, unknown> }> = []
  sceneItems = new Map<string, Array<{
    sourceName: string
    sceneItemId: number
    sceneItemEnabled: boolean
  }>>([['Gameplay', []]])
  streaming = false
  recording = false
  activateRecordingOnStart = true
  recordingPath = 'C:\\Videos\\tko-test.mkv'
  failVersionCount = 0

  on(event: string, handler: Handler) {
    const handlers = this.handlers.get(event) ?? []
    handlers.push(handler)
    this.handlers.set(event, handlers)
    return this
  }

  emit(event: string, value: unknown) {
    for (const handler of this.handlers.get(event) ?? []) handler(value)
  }

  async connect() {
    this.connectCount += 1
    return { obsWebSocketVersion: '5.5.0', negotiatedRpcVersion: 1 }
  }

  async disconnect() {}

  async call(request: string, data: Record<string, any> = {}): Promise<any> {
    switch (request) {
      case 'GetVersion':
        if (this.failVersionCount > 0) {
          this.failVersionCount -= 1
          throw new Error('OBS is not ready')
        }
        return { obsVersion: '31.0.0', obsWebSocketVersion: '5.5.0' }
      case 'GetSceneList':
        return {
          currentProgramSceneName: this.currentScene,
          currentProgramSceneUuid: 'current',
          currentPreviewSceneName: null,
          currentPreviewSceneUuid: null,
          scenes: this.scenes,
        }
      case 'GetInputList':
        return {
          inputs: this.inputs
            .filter((input) => !data.inputKind || input.inputKind === data.inputKind)
            .map(({ inputName, inputKind }) => ({ inputName, inputKind })),
        }
      case 'GetInputSettings': {
        const input = this.inputs.find((entry) => entry.inputName === data.inputName)
        if (!input) throw new Error('Input not found')
        return { inputSettings: input.settings, inputKind: input.inputKind }
      }
      case 'GetSceneItemList':
        return { sceneItems: this.sceneItems.get(data.sceneName) ?? [] }
      case 'GetVideoSettings':
        return { baseWidth: 1920, baseHeight: 1080 }
      case 'CreateScene':
        this.scenes.push({ sceneName: data.sceneName, sceneIndex: this.scenes.length })
        this.sceneItems.set(data.sceneName, [])
        return { sceneUuid: `scene-${this.scenes.length}` }
      case 'CreateInput':
        this.inputs.push({
          inputName: data.inputName,
          inputKind: data.inputKind,
          settings: { ...data.inputSettings },
        })
        this.sceneItems.get(data.sceneName)?.push({
          sourceName: data.inputName,
          sceneItemId: 1,
          sceneItemEnabled: data.sceneItemEnabled !== false,
        })
        return { inputUuid: 'input-1', sceneItemId: 1 }
      case 'SetInputSettings': {
        const input = this.inputs.find((entry) => entry.inputName === data.inputName)
        if (!input) throw new Error('Input not found')
        input.settings = { ...input.settings, ...data.inputSettings }
        return undefined
      }
      case 'CreateSceneItem': {
        const items = this.sceneItems.get(data.sceneName) ?? []
        items.push({
          sourceName: data.sourceName,
          sceneItemId: items.length + 1,
          sceneItemEnabled: data.sceneItemEnabled !== false,
        })
        this.sceneItems.set(data.sceneName, items)
        return { sceneItemId: items.length }
      }
      case 'SetSceneItemEnabled': {
        const item = (this.sceneItems.get(data.sceneName) ?? [])
          .find((entry) => entry.sceneItemId === data.sceneItemId)
        if (item) item.sceneItemEnabled = data.sceneItemEnabled
        return undefined
      }
      case 'SetCurrentProgramScene':
        this.currentScene = data.sceneName
        return undefined
      case 'GetStreamStatus':
        return {
          outputActive: this.streaming,
          outputReconnecting: false,
          outputDuration: 0,
        }
      case 'StartStream':
        this.streaming = true
        return undefined
      case 'StopStream':
        this.streaming = false
        return undefined
      case 'GetRecordStatus':
        return {
          outputActive: this.recording,
          outputPaused: false,
          outputDuration: 0,
        }
      case 'StartRecord':
        if (this.activateRecordingOnStart) this.recording = true
        return undefined
      case 'StopRecord':
        this.recording = false
        return { outputPath: this.recordingPath }
      default:
        throw new Error(`Unhandled fake OBS request: ${request}`)
    }
  }
}

function createClient(socket: FakeOBSSocket, confirmationTimeoutMs = 50) {
  return new OBSClient(socket as unknown as OBSWebSocket, {
    reconnectDelaysMs: [1],
    outputPollIntervalMs: 60_000,
    confirmationTimeoutMs,
    confirmationPollIntervalMs: 1,
  })
}

describe('buildProgramOutputUrl', () => {
  it('uses the root route for root-mounted builds', () => {
    expect(buildProgramOutputUrl({
      origin: 'http://localhost:5889',
      pathname: '/live',
      baseUrl: '/',
    })).toBe('http://localhost:5889/program')
  })

  it('uses /app/program for hosted builds and runtime /app fallbacks', () => {
    expect(buildProgramOutputUrl({
      origin: 'https://tko.cam',
      pathname: '/app/live',
      baseUrl: '/app/',
    })).toBe('https://tko.cam/app/program')
    expect(buildProgramOutputUrl({
      origin: 'https://tko.cam',
      pathname: '/app/host',
      baseUrl: '/',
    })).toBe('https://tko.cam/app/program')
  })

  it('uses the configured web app from a non-http desktop origin', () => {
    expect(buildProgramOutputUrl({
      origin: 'tauri://localhost',
      pathname: '/host',
      baseUrl: '/',
      appUrl: 'https://tko.cam/app',
      layout: 8,
    })).toBe('https://tko.cam/app/program?layout=8')
  })
})

describe('OBSClient live-output readiness', () => {
  it('does not accept an arbitrary current scene and creates the exact browser source', async () => {
    const socket = new FakeOBSSocket()
    const client = createClient(socket)
    const programUrl = 'https://tko.cam/app/program'
    await client.connect({ host: 'localhost', port: 4455, password: 'test' })

    const before = await client.getProgramSourceStatus(programUrl)
    expect(before.ready).toBe(false)
    expect(before.detail).toContain('has not been created')

    const after = await client.ensureProgramSource(programUrl)
    expect(after.ready).toBe(true)
    expect(socket.currentScene).toBe(TKO_PROGRAM_SCENE)
    expect(socket.inputs).toContainEqual(expect.objectContaining({
      inputName: TKO_PROGRAM_SOURCE,
      inputKind: 'browser_source',
      settings: expect.objectContaining({
        url: programUrl,
        width: 1920,
        height: 1080,
      }),
    }))

    await client.disconnect()
  })

  it('recovers readiness after an unexpected WebSocket close', async () => {
    const socket = new FakeOBSSocket()
    const client = createClient(socket)
    await client.connect({ host: 'localhost', port: 4455, password: '' })

    socket.emit('ConnectionClosed', new Error('socket dropped'))
    expect(client.getStatus()).toBe('reconnecting')
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(socket.connectCount).toBe(2)
    expect(client.getStatus()).toBe('connected')
    await client.disconnect()
  })

  it('retries when the socket opens before OBS readiness probes succeed', async () => {
    const socket = new FakeOBSSocket()
    socket.failVersionCount = 1
    const client = createClient(socket)

    await expect(client.connect({
      host: 'localhost',
      port: 4455,
      password: '',
    })).rejects.toThrow('OBS is not ready')
    expect(client.getStatus()).toBe('reconnecting')
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(socket.connectCount).toBe(2)
    expect(client.getStatus()).toBe('connected')
    await client.disconnect()
  })
})

describe('OBSClient recording confirmation', () => {
  it('confirms recording transitions and returns OBS exact output path', async () => {
    const socket = new FakeOBSSocket()
    const client = createClient(socket)
    await client.connect({ host: 'localhost', port: 4455, password: '' })

    await client.startRecording()
    expect(client.getStreamState().isRecording).toBe(true)
    const result = await client.stopRecording()
    expect(result.outputPath).toBe(socket.recordingPath)
    expect(client.getStreamState()).toEqual(expect.objectContaining({
      isRecording: false,
      recordingPath: socket.recordingPath,
      recordingError: null,
    }))

    await client.disconnect()
  })

  it('surfaces a confirmation error when OBS never enters recording state', async () => {
    const socket = new FakeOBSSocket()
    socket.activateRecordingOnStart = false
    const client = createClient(socket, 5)
    await client.connect({ host: 'localhost', port: 4455, password: '' })

    await expect(client.startRecording()).rejects.toThrow(
      'OBS could not confirm recording started',
    )
    expect(client.getStreamState().recordingError).toContain(
      'OBS could not confirm recording started',
    )

    await client.disconnect()
  })
})
