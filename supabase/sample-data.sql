-- OPTIONAL: demo data so you can try the full learner journey straight away.
-- Run after schema.sql. Delete the demo organisation later to remove it all.

with o as (insert into organisations(name, contact_name) values ('Demo Organisation', 'Demo Contact') returning id),
     p as (insert into packages(code, name, description, validity_months)
           values ('HIS-DEMO', 'Demo – Enteral Feeding Support',
                   'Theory and practical training in safe enteral (PEG) feeding support.', 12) returning id),
     w as (insert into workbooks(title, description, version, pass_percent)
           values ('Demo Workbook – Enteral Feeding Basics', 'Answer every question. Use your own words for written answers.', '1.0', 100) returning id),
     q as (insert into questions(workbook_id, position, section, prompt, qtype, options, marks)
           select w.id, x.pos, x.sec, x.prompt, x.qtype, x.opts::jsonb, x.marks from w,
           (values (1, 'Infection control', 'What must you do before and after every feeding procedure?', 'short', '[]', 1),
                   (2, 'Infection control', 'Which of these is the correct action if the stoma site is red, swollen or leaking?',
                       'multiple_choice', '["Continue the feed and check tomorrow","Stop, follow the care plan and report it","Clean it with alcohol wipes"]', 1),
                   (3, 'Positioning', 'The participant should be positioned upright (at least 30–45°) during and after feeding.', 'true_false', '[]', 1),
                   (4, 'Positioning', 'Describe the signs of aspiration and what you would do.', 'long', '[]', 2))
             as x(pos, sec, prompt, qtype, opts, marks) returning id, position),
     k as (insert into question_keys(question_id, correct_answer, marking_guide)
           select q.id, case q.position when 2 then 'Stop, follow the care plan and report it' when 3 then 'True'
                                        when 1 then 'Hand hygiene (wash or sanitise hands) and use PPE' end,
                        case q.position when 4 then 'Coughing, choking, wet/gurgly voice, breathing difficulty, colour change; stop feed, sit upright, call for help / follow emergency plan' end
           from q returning 1),
     pw as (insert into package_workbooks(package_id, workbook_id, position) select p.id, w.id, 1 from p, w returning 1),
     c as (insert into competencies(package_id, position, description)
           select p.id, x.n, x.d from p, (values
             (1, 'Performs hand hygiene and uses PPE correctly'),
             (2, 'Reads and follows the participant''s mealtime / enteral feeding plan'),
             (3, 'Positions the participant correctly before, during and after the feed'),
             (4, 'Checks the stoma site and equipment and reports concerns'),
             (5, 'Administers the feed and flushes the tube as per the plan'),
             (6, 'Recognises and responds to signs of aspiration or distress'),
             (7, 'Documents the procedure accurately')) as x(n, d) returning 1)
insert into invites(code, organisation_id, package_id, note)
select 'DEMO01', o.id, p.id, 'Demo code' from o, p;
