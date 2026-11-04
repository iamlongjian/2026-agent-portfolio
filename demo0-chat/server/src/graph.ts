import 'dotenv/config'
import { ChatDeepSeek } from '@langchain/deepseek'
import {
  StateGraph,
  StateSchema,
  MessagesValue,
  START,
  END,
  MemorySaver,
} from '@langchain/langgraph'
import { SystemMessage } from '@langchain/core/messages'

const model = new ChatDeepSeek({ model: 'deepseek-flash', temperature: 0 })

const MessageState = new StateSchema({
  messages: MessagesValue,
})

const llmCall = async (state) => {
  const response = await model.invoke([
    new SystemMessage('你是一个天气助手，回答要简洁友好。'),
    ...state.messages,
  ])
  return { messages: [response] }
}

const checkpointer = new MemorySaver()

export const graph = new StateGraph(MessageState)
  .addNode('llmCall', llmCall)
  .addEdge(START, 'llmCall')
  .addEdge('llmCall', END)
  .compile({ checkpointer })
