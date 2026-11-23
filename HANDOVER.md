# Handover – NDIS Training Portal

These steps are for the new owner. Everything is set up under **your** accounts, so you own the data, the code and the Claude access. The previous builder keeps no access unless you invite them.

## 1. GitHub – store the code
1. Sign in at github.com, or create a free account.
2. Create a new **private** repository named `ndis-training-portal`.
3. Choose **Add file → Upload files**, then drag in everything from the unzipped `ndis-training` folder, including `CLAUDE.md`. Commit.

## 2. Supabase – database and logins
1. Sign in at supabase.com and create a new project in the **Sydney (ap-southeast-2)** region.
2. Follow README steps 2, 3, 6 and 7. Those cover running `schema.sql`, pasting your keys into `js/config.js`, setting your site address, and making yourself the admin.
3. Commit the updated `js/config.js` to GitHub.

## 3. Publish the site
Follow README step 5 (Netlify or Vercel). Connect it to **your** GitHub repo so every change you commit goes live automatically.

## 4. Connect your Claude account
In Claude, open **Settings → Connectors**:
1. Connect **GitHub** and give it access to the `ndis-training-portal` repo.
2. Connect **Supabase** and sign in with your Supabase account.

Then start a new chat, attach the repo, and paste:

> I own the NDIS training portal in my GitHub repo `ndis-training-portal`, with its database in my Supabase project. Read CLAUDE.md in the repo for context, then confirm you can see both the repo and the Supabase project.

Claude will then be able to make code changes, run database updates and check logs for you.

## 5. Tidy up
- Change any passwords or keys that were shared with you during handover.
- If the previous builder needs to help later, add them temporarily. In GitHub that's **Settings → Collaborators**; in Supabase it's **Organization → Team**. Remove them when they're done.
- Before real learners use the site, set up your own email sender and consider the Supabase Pro plan for backups (see README, "Good to know").
