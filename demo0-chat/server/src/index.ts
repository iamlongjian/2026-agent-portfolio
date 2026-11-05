// @ts-nocheck

import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { graph } from './graph'
import { HumanMessage } from '@langchain/core/messages'

const app = express()
app.use(cors())
app.use(express.json())

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    model: 'deepseek-flash',
  })
})

app.post('/api/chat', async (req, res) => {
  const body = req.body
  if (!body.message?.trim() || !body.threadId?.trim()) {
    res.status(400)
    res.json({ error: '少了参数' })
    return
  }
  const headers = new Headers({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  res.setHeaders(headers)
  res.flushHeaders()
  try {
    const stream = await graph.stream(
      { messages: [new HumanMessage(body.message?.trim())] },
      {
        configurable: { thread_id: body.threadId },
        streamMode: 'messages',
      },
    )
    for await (const [chunk, metadata] of stream) {
      if (chunk.content) {
        const data = JSON.stringify({ content: chunk.content })
        res.write(`data: ${data}\n\n`)
      }
    }
    res.write(`data: [DONE]\n\n`)
    res.end()
  } catch (error) {
    console.error(error)
    const errmsg = JSON.stringify({ error: error.message })
    res.write(`data: ${errmsg}\n\n`)
    res.write(`data: [DONE]\n\n`)
    res.end()
  }
})

const PORT = process.env.PORT ?? 3001
app.listen(PORT, () => {
  console.log('🐶B')
})
