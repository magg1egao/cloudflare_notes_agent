import { createWorkersAI } from "workers-ai-provider";
import { routeAgentRequest, callable, type Schedule } from "agents";
import { getSchedulePrompt, scheduleSchema } from "agents/schedule";
import { AIChatAgent } from "@cloudflare/ai-chat";
import {
  streamText,
  convertToModelMessages,
  pruneMessages,
  tool,
  stepCountIs,
  type StreamTextOnFinishCallback,
  type ToolSet
} from "ai";
import { z } from "zod";
import { notStrictEqual } from "node:assert";
export { ResearchWorkflow } from "./workflow";

type ResearchNote = {
  id: string;
  title: string,
  content: string;
  sources: string[];
  createdAt: string;
}

export class ChatAgent extends AIChatAgent<Env> {
  async onChatMessage(
    onFinish: StreamTextOnFinishCallback<ToolSet>,
    options?: { abortSignal?: AbortSignal }
  ) {
    const workersai = createWorkersAI({ binding: this.env.AI });

    const result = streamText({
      model: workersai("@cf/qwen/qwen3-30b-a3b-fp8"),
      system: `You are a Research agent: An AI that helps users research 
      topics from links and notes.
      
      When the user provides url(s), you should:
      - run runResearchPipeline
      - inform user that you are running the research pipeline
      - inform user about the other tools at their disposal
      - do not ask questions. Say nothing else
     
      Other tools:
      - listNotes: list all notes
      - fetchUrl: get content of webpage
      - saveNote: save a note
      - displayNote: display/get a specific note
      - deleteNote: delete a note
      
      Please only use saveNote when you have the user's permission. Do not saveNote automatically.
      `      
      ,
      // Prune old tool calls to save tokens on long conversations
      messages: pruneMessages({
        messages: await convertToModelMessages(this.messages),
        toolCalls: "before-last-2-messages"
      }),
      tools: {
        // Server-side tool: runs automatically on the server
        // getWeather: tool({
        //   description: "Get the current weather for a city",
        //   inputSchema: z.object({
        //     city: z.string().describe("City name")
        //   }),
        //   execute: async ({ city }) => {
        //     // Replace with a real weather API in production
        //     const conditions = ["sunny", "cloudy", "rainy", "snowy"];
        //     const temp = Math.floor(Math.random() * 30) + 5;
        //     return {
        //       city,
        //       temperature: temp,
        //       condition:
        //         conditions[Math.floor(Math.random() * conditions.length)],
        //       unit: "celsius"
        //     };
        //   }
        // }),

        // Client-side tool: no execute function — the browser handles it
        // getUserTimezone: tool({
        //   description:
        //     "Get the user's timezone from their browser. Use this when you need to know the user's local time.",
        //   inputSchema: z.object({})
        // }),

        // Approval tool: requires user confirmation before executing
        // calculate: tool({
        //   description:
        //     "Perform a math calculation with two numbers. Requires user approval for large numbers.",
        //   inputSchema: z.object({
        //     a: z.number().describe("First number"),
        //     b: z.number().describe("Second number"),
        //     operator: z
        //       .enum(["+", "-", "*", "/", "%"])
        //       .describe("Arithmetic operator")
        //   }),
        //   needsApproval: async ({ a, b }) =>
        //     Math.abs(a) > 1000 || Math.abs(b) > 1000,
        //   execute: async ({ a, b, operator }) => {
        //     const ops: Record<string, (x: number, y: number) => number> = {
        //       "+": (x, y) => x + y,
        //       "-": (x, y) => x - y,
        //       "*": (x, y) => x * y,
        //       "/": (x, y) => x / y,
        //       "%": (x, y) => x % y
        //     };
        //     if (operator === "/" && b === 0) {
        //       return { error: "Division by zero" };
        //     }
        //     return {
        //       expression: `${a} ${operator} ${b}`,
        //       result: ops[operator](a, b)
        //     };
        //   }
        // }),

        // scheduleTask: tool({
        //   description:
        //     "Schedule a task to be executed at a later time. Use this when the user asks to be reminded or wants something done later.",
        //   inputSchema: scheduleSchema,
        //   execute: async ({ when, description }) => {
        //     if (when.type === "no-schedule") {
        //       return "Not a valid schedule input";
        //     }
        //     const input =
        //       when.type === "scheduled"
        //         ? when.date
        //         : when.type === "delayed"
        //           ? when.delayInSeconds
        //           : when.type === "cron"
        //             ? when.cron
        //             : null;
        //     if (!input) return "Invalid schedule type";
        //     try {
        //       this.schedule(input, "executeTask", description);
        //       return `Task scheduled: "${description}" (${when.type}: ${input})`;
        //     } catch (error) {
        //       return `Error scheduling task: ${error}`;
        //     }
        //   }
        // }),

        // getScheduledTasks: tool({
        //   description: "List all tasks that have been scheduled",
        //   inputSchema: z.object({}),
        //   execute: async () => {
        //     const tasks = this.getSchedules();
        //     return tasks.length > 0 ? tasks : "No scheduled tasks found.";
        //   }
        // }),

        // cancelScheduledTask: tool({
        //   description: "Cancel a scheduled task by its ID",
        //   inputSchema: z.object({
        //     taskId: z.string().describe("The ID of the task to cancel")
        //   }),
        //   execute: async ({ taskId }) => {
        //     try {
        //       this.cancelSchedule(taskId);
        //       return `Task ${taskId} cancelled.`;
        //     } catch (error) {
        //       return `Error cancelling task: ${error}`;
        //     }
        //   }
        // }),

        runResearchPipeline: tool({
          description: "Run the research workflow on URLs, then ask the user if it should be saved as a note.",
          inputSchema: z.object({
            urls: z.array(z.httpUrl())
          }),
          execute: async ({urls}) => {
            const instanceId = await this.runWorkflow("RESEARCH_WORKFLOW", {urls});
            return {workflowId: instanceId}
          }
        }),

        // approve: tool({
        //   description: "Approve the pending workflow approval gate. Use when the user says 'approve' or 'yes save'.",
        //   inputSchema: z.object({ workflowId: z.string().optional() }),
        //   execute: async ({ workflowId }) => {
        //     const pending = await this.ctx.storage.get<any>("last_pending_workflow");
        //     const id = workflowId ?? pending?.workflowId;
        //     if (!id) return { success: false, error: "No pending workflow found." };

        //     await this.approveWorkflow(id, { reason: "Approved by user in chat" });
        //     return { ok: true, workflowId: id };
        //   }
        // }),

        // reject: tool({
        //   description: "Reject the pending workflow approval gate. Use when the user says 'rejent' or 'no don't save'.",
        //   inputSchema: z.object({ workflowId: z.string().optional() }),
        //   execute: async ({ workflowId }) => {
        //     const pending = await this.ctx.storage.get<any>("last_pending_workflow");
        //     const id = workflowId ?? pending?.workflowId;
        //     if (!id) return { success: false, error: "No pending workflow found." };

        //     await this.approveWorkflow(id, { reason: "Rejected by user in chat" });
        //     return { success: true, workflowId: id };
        //   }
        // }),

        fetchUrl: tool({
          description: "Get a webpage by the url and return plain text from it to summarize",
          inputSchema: z.object({
            url: z.httpUrl().describe("The url of the page")
          }),
          execute: async({ url }) => {
            try {
              // console.log("hello")
              const res = await fetch(url, 
                {headers: {
                  "user-agent": "research-agent"
                }}
              );
              // console.log("hello")
              
              if (!res.ok) {
                return `Fetch failed: ${res.status} ${res.statusText}`
              }

              const contentType = res.headers.get("content-type") || "";
              const raw = await res.text();
              // console.log(raw)
              const text = raw.slice(0, 45_000);

              return { url, contentType, text };

            } catch (error) {
              return `Error fetching: ${url}`;
            }
          }
        }),

        saveNote: tool({
          description: "Save a research note to long term memory",
          inputSchema: z.object({
            title: z.string(),
            content: z.string(),
            sources: z.array(z.httpUrl()).optional()
          }),
          execute: async({ title, content, sources }) => {
            const id = `note:${Date.now()}`;
            const note: ResearchNote = {
              id: id,
              title,
              content,
              sources: sources ?? [],
              createdAt: new Date().toISOString()
            };
            await this.ctx.storage.put(title, note);
            return {success: true, note}
          }
        }),

        listNotes: tool({
          description: "List the saved research notes",
          inputSchema: z.object({}),
          execute: async({}) => {
            // const list = await this.ctx.storage.list();

            // for (const key of list.keys()) {
            //   await this.ctx.storage.delete(key);
            // }
            

            const list = await this.ctx.storage.list<ResearchNote>({
              // prefix: "Title: "
            });
            // const notes = Array.from(list.values()).map((n) => ({
            //   id: n.id,
            //   title: n.title,
            //   createdAt: n.createdAt,
            //   sources: n.sources,
            //   preview: n.content.slice(0,180)
            // }));
            const notes = Array.from(list.entries())
              .filter(([key]) => key !== "last_pending_workflow")
              .map(([_, n]) => ({
                id: n.id,
                title: n.title,
                createdAt: n.createdAt,
                sources: n.sources,
                preview: n.content.slice(0, 180)
              }));
            
            notes.sort((a,b) => (a.createdAt < b.createdAt ? 1 : -1));
            return notes.length ? notes : "No notes saved yet";

          }

        }),

        displayNote: tool({
          description: "Open a saved note (from listNotes)",
          inputSchema: z.object({
            title: z.string().describe("The note title"),
          }),
          execute: async({title}) => {
            const note = await this.ctx.storage.get<ResearchNote>(title);
            return note ?? {success: false, error: "Note not found"}
          }
        }),

        deleteNote: tool({
          description: "Delete a note",
          inputSchema: z.object({
            title: z.string().describe("The note title")
          }),
          execute: async({title}) => {
            const note = await this.ctx.storage.get<ResearchNote>(title);
            if (!note) {
              return {success: false, error: "Note not found"}
            }
            await this.ctx.storage.delete(title)
            return {success: true}
          }
        })
      },
      onFinish,
      stopWhen: stepCountIs(100),
      abortSignal: options?.abortSignal
    });

    return result.toUIMessageStreamResponse();
  }

  async executeTask(description: string, _task: Schedule<string>) {
    // Do the actual work here (send email, call API, etc.)
    console.log(`Executing scheduled task: ${description}`);

    // Notify connected clients via a broadcast event.
    // We use broadcast() instead of saveMessages() to avoid injecting
    // into chat history — that would cause the AI to see the notification
    // as new context and potentially loop.
    this.broadcast(
      JSON.stringify({
        type: "scheduled-task",
        description,
        timestamp: new Date().toISOString()
      })
    );
  }

  async saveNoteFromWorkflow( input: {title: string; content: string; sources: string[]}) {
    const id = `note:${Date.now()}`;
    const note: ResearchNote = {
      id: id,
      title: input.title,
      content: input.content,
      sources: input.sources,
      createdAt: new Date().toISOString()
    };
    // const new_title = "Title: " + input.title
    await this.ctx.storage.put(input.title, note);
    return input.title
  }

  async onWorkflowProgress(workflowName: string, workflowId: string, progress: unknown): Promise<void> {
    await this.ctx.storage.put("last_pending_workflow", {workflowName, workflowId, progress});
    const p = progress as { step: string; status: string; message?: string };
    this.broadcast(JSON.stringify({type: "workflow-progress", workflowName, workflowId, progress}))

    // if (p.step === "approval" && p.status === "pending") {
    //   this.broadcast(JSON.stringify({type: "workflow-progress", workflowName, workflowId, progress}))

    // }
  }

  @callable()
  async approve(workflowId: string): Promise<void> {
    await this.approveWorkflow(workflowId, {
      reason: "Synthesis approved",
      metadata: { approvedAt: Date.now() },
    });

    this.broadcast(
      JSON.stringify({
        type: "approval-result",
        status: "approved",
        workflowId
      })
    );

    // Update state to reflect approval
    // this.setState({
    //   ...this.state,
    //   pendingApprovals: this.state.pendingApprovals.filter(
    //     (p) => p.workflowId !== workflowId,
    //   ),
    // });
  }
  @callable()
  async reject(workflowId: string): Promise<void> {
    await this.rejectWorkflow(workflowId);

    this.broadcast(
      JSON.stringify({
        type: "approval-result",
        status: "approved",
        workflowId
      })
    );

    // this.setState({
    //   ...this.state,
    //   pendingApprovals: this.state.pendingApprovals.filter(
    //     (p) => p.workflowId !== workflowId,
    //   ),
    // });
  }

}

export default {
  async fetch(request: Request, env: Env) {
    return (
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;
