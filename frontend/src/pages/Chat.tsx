import React, { useCallback, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { NavBar } from '../App'

interface ChatMsg {
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
}

const WELCOME: ChatMsg = {
  role: 'assistant',
  content: 'Olá! 👋 Manda uma mensagem ou segura o botão de microfone pra falar comigo por voz.',
}

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMsg[]>([WELCOME])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const abortRef = useRef<AbortController | null>(null)

  const scrollDown = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => { scrollDown() }, [messages, scrollDown])

  // Stop streaming on unmount
  useEffect(() => () => abortRef.current?.abort(), [])

  async function sendMessage(text: string) {
    const trimmed = text.trim()
    if (!trimmed || busy) return
    setInput('')
    setError(null)
    setBusy(true)

    const history: ChatMsg[] = [...messages, { role: 'user', content: trimmed }]
    setMessages(history)

    const apiMessages = history.map(({ role, content }) => ({ role, content }))

    const controller = new AbortController()
    abortRef.current = controller
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiMessages, stream: true }),
        signal: controller.signal,
      })
      if (!res.ok) {
        const detail = await res.text().catch(() => '')
        throw new Error(`Erro ${res.status}: ${detail.slice(0, 200)}`)
      }
      if (!res.body) throw new Error('Sem stream no response')

      setMessages((prev) => [...prev, { role: 'assistant', content: '', streaming: true }])
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        // SSE: lines separated by \n\n, each "data: {...}"
        const parts = buffer.split('\n\n')
        buffer = parts.pop() ?? ''
        for (const part of parts) {
          const line = part.trim()
          if (!line.startsWith('data:')) continue
          const payload = line.slice(5).trim()
          if (payload === '[DONE]') continue
          try {
            const json = JSON.parse(payload)
            const delta = json.choices?.[0]?.delta?.content
            if (delta) {
              setMessages((prev) => {
                const next = [...prev]
                const last = next[next.length - 1]
                if (last && last.role === 'assistant' && last.streaming) {
                  next[next.length - 1] = { ...last, content: last.content + delta }
                }
                return next
              })
            }
          } catch {
            // ignore keep-alive / partial json
          }
        }
      }
      setMessages((prev) => {
        const next = [...prev]
        const last = next[next.length - 1]
        if (last && last.streaming) next[next.length - 1] = { ...last, streaming: false }
        return next
      })
    } catch (err: unknown) {
      if ((err as Error).name === 'AbortError') return
      setError(`Falha na comunicação: ${(err as Error).message}`)
      setMessages((prev) => prev.map((m, i) => (i === prev.length - 1 && m.streaming ? { ...m, streaming: false } : m)))
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }

  async function startRecording() {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mime = MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : MediaRecorder.isTypeSupported('audio/ogg')
          ? 'audio/ogg'
          : ''
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      chunksRef.current = []
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(chunksRef.current, { type: mime || 'audio/webm' })
        if (blob.size < 1000) {
          setError('Nada capturado — fala mais perto do microfone.')
          return
        }
        await transcribe(blob)
      }
      recorder.start()
      mediaRecorderRef.current = recorder
      setRecording(true)
    } catch {
      setError('Microfone não disponível (precisa de permissão e HTTPS/localhost).')
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop()
    mediaRecorderRef.current = null
    setRecording(false)
  }

  async function transcribe(blob: Blob) {
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('file', blob, 'recording.webm')
      fd.append('language', 'pt')
      const res = await fetch('/api/voice', { method: 'POST', body: fd })
      if (!res.ok) {
        const detail = await res.text().catch(() => '')
        throw new Error(`Erro ${res.status}: ${detail.slice(0, 200)}`)
      }
      const data = await res.json()
      const text: string = data.text ?? ''
      if (text) {
        setInput((prev) => (prev ? prev + ' ' + text : text))
      } else {
        setError('Não entendi o áudio — tenta de novo.')
      }
    } catch (err: unknown) {
      setError(`Falha na transcrição: ${(err as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void sendMessage(input)
    }
  }

  return (
    <div className="min-h-screen bg-bg-base">
      <NavBar />
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 flex flex-col h-[calc(100vh-64px)]">
        <div className="flex-1 overflow-y-auto space-y-4 pb-4">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                  m.role === 'user'
                    ? 'bg-accent text-white rounded-br-sm'
                    : 'bg-bg-elevated border border-border rounded-bl-sm text-text-primary'
                }`}
              >
                {m.role === 'user' ? (
                  <span className="whitespace-pre-wrap">{m.content}</span>
                ) : (
                  <div className="prose-invert">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content || (m.streaming ? '…' : '')}</ReactMarkdown>
                    {m.streaming && <span className="inline-block w-2 h-4 bg-accent animate-pulse ml-0.5 align-middle" />}
                  </div>
                )}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {error && (
          <div className="mb-2 px-3 py-2 rounded-lg bg-error-subtle/50 border border-error/30 text-xs text-error">
            {error}
          </div>
        )}

        <div className="flex items-end gap-2 border-t border-border pt-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Mensagem pro Hermes… (Enter envia, Shift+Enter quebra linha)"
            rows={1}
            className="flex-1 resize-none bg-bg-elevated border border-border rounded-xl px-3 py-2.5 text-sm text-text-primary placeholder-text-tertiary focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <button
            onMouseDown={(e) => { e.preventDefault(); if (!recording) void startRecording() }}
            onMouseUp={() => { if (recording) stopRecording() }}
            onMouseLeave={() => { if (recording) stopRecording() }}
            onTouchStart={(e) => { e.preventDefault(); if (!recording) void startRecording() }}
            onTouchEnd={() => { if (recording) stopRecording() }}
            disabled={busy}
            title="Segurar pra falar (push-to-talk)"
            className={`shrink-0 w-11 h-11 rounded-full flex items-center justify-center transition-colors ${
              recording ? 'bg-error text-white animate-pulse' : 'bg-bg-elevated border border-border text-text-secondary hover:text-error hover:border-error/50'
            }`}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="22" />
            </svg>
          </button>
          <button
            onClick={() => void sendMessage(input)}
            disabled={busy || !input.trim()}
            className="shrink-0 w-11 h-11 rounded-full bg-accent text-white flex items-center justify-center hover:opacity-90 disabled:opacity-40 transition-opacity"
            title="Enviar"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
        <p className="text-[11px] text-text-tertiary mt-2 text-center">
          {recording ? 'Gravando… solta o botão pra transcrever' : busy ? 'Hermes trabalhando…' : 'Chat direto com o Hermes (API server local, tools + memória ativos)'}
        </p>
      </div>
    </div>
  )
}
