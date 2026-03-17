import { AgentWorkflow } from "agents/workflows";
import type { AgentWorkflowEvent, AgentWorkflowStep } from "agents/workflows";
import { createWorkersAI } from "workers-ai-provider";
import { generateText } from "ai";
import type { ChatAgent } from "./server";

type Params = {
    urls: string[]
}

export class ResearchWorkflow extends AgentWorkflow<ChatAgent, Params> {
  async run(event: AgentWorkflowEvent<Params>, step: AgentWorkflowStep) {
    console.log("starting")
    const { urls } = event.payload;
    console.log("here")
    const pages = await step.do("gather sources", async () => {
        return Promise.all(
            urls.map(async (url) => {
                const res = await fetch(url, {headers: {"user-agent": "research-agent/1.0"}});
                const text = (await res.text()).slice(0, 20_000);
                return {url, ok: res.ok, status: res.status, text}
            })
        )
    });
    console.log("here2")

    const workersai = createWorkersAI({ binding: this.env.AI });
    console.log("here3")
    const synthesis = await step.do("synthesize", async () => {
        const context = pages.map(
            (p) => p.ok ? `SOURCE: ${p.url}\n${p.text}` : 
            `SOURCE: ${p.url}\nERROR: ${p.status}`
        ).join("\n\n");
        const output = await generateText({
            model: workersai("@cf/qwen/qwen3-30b-a3b-fp8"),
            prompt: `
            Summarize each SOURCE (3-6 bullets), then write a SYNTHESIS section:
            - key takeaways
            - uncertainty or limitations
            - possible follow up questions
            
            Cite by the URL
            
            CONTENT: ${context}`
        });
        return output.text;

    });
    console.log("here4")

    const title = await step.do("generate title", async () => {
        const output = await generateText({
            model: workersai("@cf/qwen/qwen3-30b-a3b-fp8"),
            prompt: `
            Generate an extremely simple and short title based on this synthesis.
            Do not output 'Title: ..' Just simply output the title name
            
            SYNTHESIS: ${synthesis}`
        });
        return output.text.trim();
    });
    console.log("here5")
    
    await this.reportProgress({
        step: "approval",
        status: "pending",
        message: "Save the urls synthesis as a note?",
        title,
        synthesis
    });
    console.log("here6")

    let approved = false;
    try {
        await this.waitForApproval(step, {timeout: "1 minute"});
        approved = true;
    } catch {
        approved = false;
    }
    console.log("here7")

    // let noteSaved = false
    if (approved) {
        await step.do("save note", async () => {
            await this.agent.saveNoteFromWorkflow({
                title, content: synthesis, sources: urls
            });
            // noteSaved = true
        });
    }
    console.log("here8")

    const res = {title: title, urls: urls, synthesis: synthesis, noteSaved: approved}
    await step.reportComplete(res)
    return res;


    
    // const request = await step.do("prepare", async () => {
    //   return { ...event.payload, preparedAt: Date.now() };
    // });

    // await this.reportProgress({
    //   step: "approval",
    //   status: "pending",
    //   message: "Awaiting approval",
    // });

    // // Throws WorkflowRejectedError if rejected
    // const approval = await this.waitForApproval<{ approvedBy: string }>(step, {
    //   timeout: "7 days",
    // });

    // console.log("Approved by:", approval?.approvedBy);

    // const result = await step.do("execute", async () => {
    //   return executeRequest(request);
    // });

    // await step.reportComplete(result);
    // return result;
  }
}

// class MyAgent extends Agent {
//   async handleApproval(instanceId: string, userId: string) {
//     await this.approveWorkflow(instanceId, {
//       reason: "Approved by admin",
//       metadata: { approvedBy: userId },
//     });
//   }

//   async handleRejection(instanceId: string, reason: string) {
//     await this.rejectWorkflow(instanceId, { reason });
//   }
// }