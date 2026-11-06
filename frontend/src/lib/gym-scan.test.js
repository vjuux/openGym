// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { providerForKey, scanRequest, answerText, parseScan, kitFromScan, scanPhotos, isKeyProblem, SCAN_PROMPT } from './gym-scan.js'
import { KIT_IDS } from './kit.js'

const pic = { mime: 'image/jpeg', data: 'QUJD' }

describe('providerForKey', () => {
  it('tells keys apart, Anthropic before the OpenAI prefix it also starts with', () => {
    expect(providerForKey('AIzaSy123')).toBe('gemini')
    expect(providerForKey(' sk-ant-abc ')).toBe('anthropic')
    expect(providerForKey('sk-proj-abc')).toBe('openai')
    expect(providerForKey('hello')).toBeNull()
    expect(providerForKey('')).toBeNull()
  })
})

describe('the prompt', () => {
  it('offers every piece of kit by its exact id', () => {
    for (const id of KIT_IDS) expect(SCAN_PROMPT).toContain(`- ${id}:`)
  })
})

describe('scanRequest', () => {
  it('sends the key as a header on every provider, never in the address', () => {
    for (const provider of ['gemini', 'openai', 'anthropic']) {
      const r = scanRequest({ provider, key: 'SECRET' }, [pic])
      expect(r.url).not.toContain('SECRET')
      expect(JSON.stringify(r.headers)).toContain('SECRET')
      expect(JSON.stringify(r.body)).toContain('QUJD')
      expect(JSON.stringify(r.body)).not.toContain('SECRET')
    }
  })
})

describe('which Gemini address', () => {
  it('sends a Vertex express key to Vertex and any other Gemini key to the Generative Language API', () => {
    expect(scanRequest({ provider: 'gemini', key: 'AQ.abc' }, [pic]).url).toContain('aiplatform.googleapis.com/v1beta1/publishers/google/models/')
    expect(scanRequest({ provider: 'gemini', key: 'AIzaabc' }, [pic]).url).toContain('generativelanguage.googleapis.com/v1beta/models/')
  })
})

describe('answerText', () => {
  it('reads each provider\'s shape', () => {
    expect(answerText('gemini', { candidates: [{ content: { parts: [{ text: 'a' }, { text: 'b' }] } }] })).toBe('ab')
    expect(answerText('openai', { choices: [{ message: { content: 'c' } }] })).toBe('c')
    expect(answerText('anthropic', { content: [{ type: 'text', text: 'd' }] })).toBe('d')
    expect(answerText('gemini', {})).toBe('')
  })
})

describe('parseScan', () => {
  it('keeps known ids only, once each at the best confidence, best first', () => {
    const scan = parseScan(JSON.stringify({ place: 'gym', kit: [
      { id: 'bench', confidence: 0.5 }, { id: 'Squat Rack', confidence: 0.9 }, { id: 'bench', confidence: 0.7 },
      { id: 'treadmill', confidence: 1 }, { id: 'dumbbells', confidence: 'lots' }, null,
    ] }))
    expect(scan.place).toBe('gym')
    expect(scan.kit).toEqual([{ id: 'squat rack', confidence: 0.9 }, { id: 'bench', confidence: 0.7 }, { id: 'dumbbells', confidence: 0 }])
  })

  it('copes with a fenced answer and an unknown place', () => {
    const scan = parseScan('Here you go:\n```json\n{"place":"moon","kit":[{"id":"rings","confidence":2}]}\n```')
    expect(scan).toEqual({ place: 'other', kit: [{ id: 'rings', confidence: 1 }] })
  })

  it('reads an empty place as empty, and no JSON as a failure', () => {
    expect(parseScan('{"place":"other","kit":[]}').kit).toEqual([])
    expect(() => parseScan('sorry, I cannot help')).toThrow()
    expect(() => parseScan('')).toThrow()
  })
})

describe('kitFromScan', () => {
  it('switches on only what the model is sure of', () => {
    expect(kitFromScan({ kit: [{ id: 'bench', confidence: 0.95 }, { id: 'leg press', confidence: 0.3 }] })).toEqual(['bench'])
  })
})

describe('scanPhotos', () => {
  const answer = status => ({ ok: status < 400, status, text: async () => JSON.stringify(status < 400
    ? { choices: [{ message: { content: '{"place":"gym","kit":[{"id":"bench","confidence":0.8}]}' } }] }
    : { error: { message: 'bad key' } }) })

  it('runs the whole trip', async () => {
    const fetcher = vi.fn().mockResolvedValue(answer(200))
    const scan = await scanPhotos([pic], { key: 'sk-abc', fetcher })
    expect(scan.kit[0].id).toBe('bench')
    expect(fetcher.mock.calls[0][0]).toContain('api.openai.com')
  })

  it('tries once more when the provider is busy, and no more than once', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(answer(429)).mockResolvedValueOnce(answer(200))
    expect((await scanPhotos([pic], { key: 'sk-abc', fetcher, retryAfter: 0 })).kit[0].id).toBe('bench')
    const busy = vi.fn().mockResolvedValue(answer(503))
    await expect(scanPhotos([pic], { key: 'sk-abc', fetcher: busy, retryAfter: 0 })).rejects.toThrow('bad key')
    expect(busy).toHaveBeenCalledTimes(2)
  })

  it('says what the provider said when it refuses', async () => {
    await expect(scanPhotos([pic], { key: 'sk-abc', fetcher: async () => answer(401) })).rejects.toThrow('bad key')
  })

  it('tells a refused key from a bad photo, so the screen can ask for another key', async () => {
    const refused = await scanPhotos([pic], { key: 'sk-abc', fetcher: async () => answer(401) }).catch(e => e)
    expect(isKeyProblem(refused)).toBe(true)
    expect(isKeyProblem(new Error('API key not valid. Please pass a valid API key.'))).toBe(true)
    expect(isKeyProblem(new Error('image too large'))).toBe(false)
  })

  it('refuses a key it cannot place without calling anyone', async () => {
    const fetcher = vi.fn()
    await expect(scanPhotos([pic], { key: 'nope', fetcher })).rejects.toThrow('unknown key')
    expect(fetcher).not.toHaveBeenCalled()
  })
})
