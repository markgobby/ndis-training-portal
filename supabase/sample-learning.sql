-- OPTIONAL: Part 1 learning material for the demo workbook. Run after sample-data.sql.
-- DEMO CONTENT ONLY – replace with your own clinically reviewed material before real use.

insert into learning_items(workbook_id, position, kind, title, body, qtype, options, answer, explanation)
select w.id, x.pos, x.kind, x.title, x.body, x.qtype, x.opts::jsonb, x.answer, x.expl
from workbooks w,
(values
 (1, 'content', 'About this workbook', $t$This workbook covers the basics of supporting a participant who receives their nutrition through a PEG tube (percutaneous endoscopic gastrostomy): a tube that passes through the abdominal wall into the stomach.

Under the NDIS, enteral feeding support is a **high intensity daily personal activity**. You must be trained and assessed as competent, and you must always follow the participant's own enteral feeding plan, written by their health professional.

**Part 1** (this part) explains what you need to know. The "Check your understanding" questions are practice only and aren't recorded.
**Part 2** is the knowledge assessment, which your trainer marks.

**Demo content:** replace this with your organisation's approved material.$t$, null, '[]', null, null),

 (2, 'content', 'Infection control', $t$PEG feeding goes directly into the body, so infection control is essential.

- Perform hand hygiene **before and after** every procedure: wash with soap and water, or use alcohol-based hand rub
- Wear gloves and other PPE as required by the plan and your organisation's policy
- Use clean equipment and a clean work surface
- Check the formula's use-by date, and store and handle it as the instructions say
- Replace giving sets and syringes as often as the plan specifies$t$, null, '[]', null, null),

 (3, 'practice', null, 'When should you perform hand hygiene during a PEG feed?', 'multiple_choice',
  '["Only after the feed is finished","Before and after the procedure","Only if your hands look dirty"]',
  'Before and after the procedure', 'Hand hygiene before protects the participant; hand hygiene after protects you and others.'),

 (4, 'content', 'Before you start a feed', $t$## Read the plan
Check the participant's enteral feeding plan every time. It tells you the formula, the volume, the rate or method, the flush volumes, and the timing.

## Check the participant
- Explain what you are doing and gain consent
- Check they are well. If they are vomiting, have a swollen or painful abdomen, or seem unwell, don't start the feed. Follow the plan and report it.

## Check the stoma and tube
- Look for redness, swelling, heat, leakage, bleeding or pain around the stoma
- Check the tube for damage or kinks, and check that its position marking matches the plan

If anything doesn't look right, **don't continue**. Follow the plan and report it straight away.$t$, null, '[]', null, null),

 (5, 'practice', null, 'If the stoma site is red and leaking, it is fine to continue the feed and mention it at the next handover.', 'true_false', '[]',
  'False', 'Stop, follow the participant''s plan, and report it straight away. These can be signs of infection or a problem with the tube.'),

 (6, 'content', 'Positioning', $t$Correct positioning reduces the risk of reflux and **aspiration**, which is when feed or fluid enters the lungs.

- Sit the participant upright, at **least 30–45 degrees**, during the feed
- Keep them upright for the length of time stated in the plan after the feed (often 30–60 minutes)
- Never feed a participant who is lying flat$t$, null, '[]', null, null),

 (7, 'practice', null, 'What position should the participant be in during a feed?', 'multiple_choice',
  '["Lying flat on their back","Upright, at least 30–45 degrees","Lying on their left side"]',
  'Upright, at least 30–45 degrees', 'Being upright helps prevent reflux and aspiration.'),

 (8, 'content', 'Giving the feed and flushing', $t$- Flush the tube with water before and after feeds and medications, using the volumes in the plan
- Give the feed exactly as the plan states: the right formula, volume, rate and method
- Never force fluid through the tube. If it seems blocked, stop and follow the plan.
- Watch the participant throughout for any signs of discomfort or distress$t$, null, '[]', null, null),

 (9, 'content', 'Recognising problems and emergencies', $t$## Signs of aspiration or distress
- Coughing, choking or gagging
- A wet or gurgly voice
- Difficulty breathing, or a change in skin colour

## What to do
- **Stop the feed immediately**
- Keep the participant upright
- Follow their emergency plan, and call **000** if they are having trouble breathing
- Report and document what happened

## If the tube comes out
Don't try to put it back in. Cover the site with clean gauze and follow the plan. Get urgent medical advice, because the stoma can start to close within hours.$t$, null, '[]', null, null),

 (10, 'practice', null, 'The PEG tube has fallen out. What should you do?', 'multiple_choice',
  '["Push it back in gently","Cover the site, follow the plan and get urgent medical advice","Wait until the next scheduled feed to see if it is a problem"]',
  'Cover the site, follow the plan and get urgent medical advice', 'Only a trained health professional should replace a tube, and the stoma can close quickly.'),

 (11, 'content', 'Documentation', $t$Record every feed in line with your organisation's policy, including:

- Date and time
- Formula type and volume given
- Water flushes
- How the participant tolerated the feed, and the condition of the stoma
- Any concerns, and who you reported them to

Report incidents using your organisation's incident reporting process.$t$, null, '[]', null, null)
) as x(pos, kind, title, body, qtype, opts, answer, expl)
where w.title = 'Demo Workbook – Enteral Feeding Basics';
