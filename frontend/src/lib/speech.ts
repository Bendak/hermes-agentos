import { useCallback, useEffect, useRef, useState } from 'react'

/** Max characters per TTS request: short chunks start playing sooner. */
const CHUNK_CHARS = 700

/** A fenced block becomes this empty fence; the server reads it as a short notice. */
const FENCE_STUB = '```\n```'

/**
 * Split a markdown reply into speakable chunks. Fenced code blocks are
 * replaced by an empty fence up front (the server reads any fence as a short
 * notice), so code is never cut in half, read aloud, or allowed to blow the
 * request size limit.
 */
export function splitForSpeech(markdown: string, max = CHUNK_CHARS): string[] {
  const lines: string[] = []
  let inFence = false
  for (const line of (markdown || '').split('\n')) {
    if (/^\s*```/.test(line)) {
      if (!inFence) lines.push('', FENCE_STUB, '')
      inFence = !inFence
      continue
    }
    if (!inFence) lines.push(line)
  }

  const blocks: string[] = []
  let current: string[] = []
  for (const line of lines) {
    if (line.trim() === '') {
      if (current.length) blocks.push(current.join('\n'))
      current = []
      continue
    }
    current.push(line)
  }
  if (current.length) blocks.push(current.join('\n'))

  const pieces: string[] = []
  for (const block of blocks) {
    if (block === FENCE_STUB) {
      pieces.push(block)
      continue
    }
    if (block.length <= max) {
      pieces.push(block)
      continue
    }
    // long prose paragraph: cut at sentence ends, then at word boundaries
    let buf = ''
    const push = (s: string) => {
      if (buf && buf.length + s.length > max) {
        pieces.push(buf.trim())
        buf = ''
      }
      buf += s
    }
    for (const sentence of block.match(/[^.!?…]+[.!?…]+["')\]]*\s*|[^.!?…]+$/g) || [block]) {
      if (sentence.length <= max) {
        push(sentence)
        continue
      }
      for (const word of sentence.split(/(?<=\s)/)) {
        if (word.length > max) {
          for (let k = 0; k < word.length; k += max) push(word.slice(k, k + max))
        } else {
          push(word)
        }
      }
    }
    if (buf.trim()) pieces.push(buf.trim())
  }

  const chunks: string[] = []
  let acc = ''
  for (const piece of pieces) {
    if (acc && acc.length + piece.length + 2 > max) {
      chunks.push(acc)
      acc = ''
    }
    acc = acc ? acc + '\n\n' + piece : piece
  }
  if (acc) chunks.push(acc)
  return chunks.filter((c) => c.trim())
}

export type SpeechStatus = 'idle' | 'loading' | 'playing'

/**
 * One reply at a time, read chunk by chunk with the next chunk prefetched
 * while the current one plays. ``speak`` with a new key interrupts the old.
 */
export function useSpeech(headers: () => Record<string, string>, onError: (msg: string) => void) {
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [status, setStatus] = useState<SpeechStatus>('idle')
  const genRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const urlsRef = useRef<string[]>([])
  const pendingRef = useRef<((err: Error) => void) | null>(null)
  const headersRef = useRef(headers)
  const onErrorRef = useRef(onError)
  headersRef.current = headers
  onErrorRef.current = onError

  const cleanup = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    // release a playback await so the old speak() loop exits instead of hanging
    const pending = pendingRef.current
    pendingRef.current = null
    if (pending) {
      const err = new Error('aborted')
      err.name = 'AbortError'
      pending(err)
    }
    const audio = audioRef.current
    if (audio) {
      audio.onended = null
      audio.onerror = null
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
    }
    audioRef.current = null
    for (const u of urlsRef.current) URL.revokeObjectURL(u)
    urlsRef.current = []
  }, [])

  const stop = useCallback(() => {
    genRef.current++
    cleanup()
    setActiveKey(null)
    setStatus('idle')
  }, [cleanup])

  useEffect(() => () => {
    genRef.current++
    cleanup()
  }, [cleanup])

  const speak = useCallback(async (key: string, markdown: string) => {
    genRef.current++
    const gen = genRef.current
    cleanup()
    const chunks = splitForSpeech(markdown)
    if (chunks.length === 0) return
    const controller = new AbortController()
    abortRef.current = controller
    setActiveKey(key)
    setStatus('loading')
    const live = () => genRef.current === gen

    const fetchChunk = async (text: string): Promise<string | null> => {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { ...headersRef.current(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      })
      if (res.status === 400) return null // nothing speakable in this chunk (e.g. only an emoji)
      if (!res.ok) {
        let detail = `HTTP ${res.status}`
        try {
          const body = await res.json()
          if (body?.detail) detail = String(body.detail)
        } catch { /* non-json */ }
        throw new Error(detail)
      }
      const url = URL.createObjectURL(await res.blob())
      urlsRef.current.push(url)
      return url
    }

    // A chunk that fails (413, engine hiccup, undecodable audio) is skipped so
    // one bad block does not silence the rest of the reply; aborts and an
    // autoplay block still end the whole read.
    const fatal = (e: Error) => e.name === 'AbortError' || e.name === 'NotAllowedError'
    let failed = 0
    let lastError = ''
    try {
      let next: Promise<string | null> = fetchChunk(chunks[0])
      for (let i = 0; i < chunks.length; i++) {
        let url: string | null = null
        try {
          url = await next
        } catch (err) {
          if (fatal(err as Error)) throw err
          failed++
          lastError = (err as Error).message
        }
        if (!live()) return
        next = i + 1 < chunks.length ? fetchChunk(chunks[i + 1]) : Promise.resolve(null)
        next.catch(() => { /* surfaced when awaited */ })
        if (!url) continue
        const audio = new Audio(url)
        audioRef.current = audio
        try {
          await new Promise<void>((resolve, reject) => {
            pendingRef.current = reject
            audio.onended = () => { pendingRef.current = null; resolve() }
            audio.onerror = () => { pendingRef.current = null; reject(new Error('falha ao tocar o áudio')) }
            audio.play().then(() => { if (live()) setStatus('playing') }).catch((e) => {
              pendingRef.current = null
              reject(e)
            })
          })
        } catch (err) {
          if (fatal(err as Error)) throw err
          failed++
          lastError = (err as Error).message
        }
        if (!live()) return
      }
      if (failed && live()) {
        onErrorRef.current(
          failed >= chunks.length
            ? 'Não consegui ler a resposta: ' + lastError
            : `Parte da resposta não pôde ser lida (${failed} de ${chunks.length} trechos): ${lastError}`,
        )
      }
    } catch (err) {
      const e = err as Error
      if (live() && e.name !== 'AbortError') {
        onErrorRef.current(
          e.name === 'NotAllowedError'
            ? 'O navegador bloqueou o áudio automático. Toque em “Ouvir” para tocar.'
            : 'Não consegui ler a resposta: ' + e.message,
        )
      }
    } finally {
      if (live()) {
        cleanup()
        setActiveKey(null)
        setStatus('idle')
      }
    }
  }, [cleanup])

  return { activeKey, status, speak, stop }
}
