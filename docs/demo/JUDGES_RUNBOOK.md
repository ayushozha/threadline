# Threadline: judge presentation

## Present one problem

Everyday memory support for an older adult, including someone living with
dementia or low vision. Lead with recovering context and retaining independence.
The four modes show where the same approach can expand; they are not four
separate products to pitch in the opening minute.

## What to say (about 90 seconds)

“Imagine your mum calls twice to ask where her glasses are. The question is
simple. The missing context isn't.

For someone living with memory loss or a disability, an ordinary task can turn
into a search, a repeated explanation, or another call for help. Threadline keeps
that context close.

The Vexo band captures speech. A camera adds what is visible. Saved conversations
preserve the person's own plans and preferences. Let me show you the part we can
verify right now.

This is an illustrative kitchen clip. When I press Ask Gemini again, the deployed
app sends its frames to Gemini. You can see the request run, its observations,
and the next action it selects.

Now I ask in Nepali. The answer comes back in Nepali beside the same image. In
Memory, I can search for the blue mug and open Evelyn's original statement.
That's context we can inspect, not just an answer we have to trust.

Deepgram handles the speech stream; Gemini combines visual context and reasoning.
The person stays in control of what they share. Our first goal is a little less
effort between needing help and getting it. Threadline: a little context, a
little closer.”

Pause the speech while waiting for the actual model. Never read a scripted
answer as if the model has returned it. The son in the film is a dramatized
presenter; do not present his story as the team's own family history.

## Exact screen order

1. Open <https://threadline.ayushojha.com/#library>. Choose **Memory**, then
   **Where are my glasses?** Use the labeled example rather than a private video.
2. Press **Ask Gemini again (live)**. Keep the pending state visible, then point
   to the actual observations and selected action. Do not promise a fixed wait.
3. In the video question field enter:

   ```text
   मेरो चस्मा कहाँ छ? नेपालीमा उत्तर दिनुहोस्।
   ```

   Meaning: “Where are my glasses? Please answer in Nepali.” Submit, then read the
   actual returned answer. The verified language demonstration is text; spoken
   Nepali playback was not verified.
4. Open <https://threadline.ayushojha.com/#graph>. Search **blue mug**, select a
   matching memory and open its source. Explain that a past statement is a last
   reported location or preference, not proof of the object's current location.
5. If there is time, return to Dashboard and show its source-linked context and
   reviewable suggestions. Avoid touring every chart.

For a short slot, do steps 1–3 live and use the already captured Memory scene in
the film. If a provider request fails, show the error honestly and use the
recorded run, explicitly introduced as a recording.

- Current two-minute film: <https://threadline.ayushojha.com/media/son-cut/newfilm.mp4>
- Downloadable media: <https://threadline.ayushojha.com/media/threadline-media-kit.zip>

## Remaining inputs and limits

| Surface | What is missing | Presentation choice |
| --- | --- | --- |
| Band and watch | Physical connection, charge, live measurements and tested gestures | Connect only band 73. Show a live transcript only after an actual spoken line appears. |
| Camera | An active selected camera or uploaded video | The Library example provides a reproducible visual demonstration; label its origin. |
| Care history | A completed consented assessment | Do not insert a past assessment or say an empty history is a medical result. |
| Contacts | The person's chosen name and contact number | Configure locally with permission; do not invent or publish family contact details. |
| Wellbeing | Real mood check-ins, health measurements, supplied clinical scores | Example charts are labeled. Missing scores remain unknown and are not inferred from speech. |
| Local-language speech | A verified successful spoken response | Demonstrate the confirmed Nepali text exchange. Do not overdub narration as live app audio. |
| External actions | Confirmed message delivery or completed call | Describe drafts and opening another app accurately. A dialer link is not a completed call. |

## Likely questions

**Why not ChatGPT?** The intended advantage is hands-free capture of the relevant
moment, persistent source-linked context and an accessible workflow. The model
alone is not the differentiation; reliable real-world capture is what we still
need to validate beyond this prototype.

**What is agentic?** The app inspects supplied evidence, selects an action and
prepares the next step. Suggestions and outgoing messages remain reviewable;
we are not claiming autonomous clinical decisions or guaranteed delivery.

**What has been verified?** Fresh deployed visual reasoning, a Nepali text
response, source retrieval, and the app's browser flows. Automated checks do not
establish clinical accuracy or physical hardware reliability.

**What is next?** Evaluate the one memory-support workflow with users and
caregivers, improve real band latency, verify multilingual speech end to end,
and measure when the assistant is useful versus when it should stay quiet.
