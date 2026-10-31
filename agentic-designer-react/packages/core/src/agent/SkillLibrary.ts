// Ported 1:1 from AgenticDesigner/Agent/SkillLibrary.swift
//
// Task-scoped playbooks for the agent tool loop — the "skills" pattern from
// coding-agent harnesses (Grok Build / Claude Code) applied to app design.
// Instead of one monolithic system prompt that tries to cover every kind of
// app, a skill is a short brief injected only when the goal matches its
// triggers (keyword match, no extra LLM call). The loop also exposes a
// `load_skill` tool so the model can pull any skill by id mid-run.

export interface AgentSkill {
  id: string;
  title: string;
  /** Lowercased keywords; any hit in the goal auto-injects the skill. */
  triggers: string[];
  /** The playbook itself — concrete steps in terms of the loop's tools. */
  instructions: string;
}

const all: AgentSkill[] = [
  {
    id: 'app-shell',
    title: 'Multi-screen app shell (navigation-first)',
    triggers: ['app', 'clone', 'product', 'mvp'],
    instructions: `PLAYBOOK app-shell — building a multi-screen app:
1. Plan 2–5 core screens (Home, Detail, and one of Search/Cart/Chat/Profile). Put them on one page as separate root frames (390x844), spaced 450pt apart on x.
2. apply_design_actions screen by screen — one call per screen, verify each with get_screenshot before the next. Don't batch 5 screens into one giant call.
3. Wire navigation FIRST (every button/card that implies another screen gets a navigate flow), then state logic (variables, toggles, counters).
4. Verify: get_logic_flows to confirm wiring exists, then preview_tap the primary path (Home → Detail → back).
5. Only then polish: images, brand color via set_brand, spacing fixes.`,
  },

  {
    id: 'auth-flow',
    title: 'Login / signup / auth flow',
    triggers: ['login', 'sign in', 'signup', 'sign up', 'auth', 'register', 'password'],
    instructions: `PLAYBOOK auth-flow:
1. Screens: Welcome (logo + CTA), Login (email Input + password Input with isSecure, submit Button, "forgot?" text, signup link), Signup (name/email/password), and the post-login Home.
2. Variables: email, password, authError, isLoggedIn (boolean).
3. Logic: bind inputs to variables; Login button flow = ifCondition (email isNotEmpty AND password isNotEmpty) → set isLoggedIn true → navigate Home; else set authError text and bind an error Text node's visibility to authError isNotEmpty.
4. If Supabase/Firebase is configured (check get_project_overview), use the real auth blocks instead of the ifCondition mock.
5. Verify with preview_tap: submit with empty fields must show the error, filled fields must navigate.`,
  },

  {
    id: 'commerce',
    title: 'E-commerce / shop / checkout',
    triggers: ['shop', 'store', 'commerce', 'cart', 'checkout', 'product', 'buy', 'marketplace'],
    instructions: `PLAYBOOK commerce:
1. Screens: Home (hero + category chips + product grid), Product Detail (large image, price, add-to-cart), Cart (line items + total + checkout CTA), optional Confirmation.
2. Product grids use a repeat-bound template node (repeatSourceVariable holding a JSON array of products with name/price/image fields) so the list is data-driven, not hand-copied cards.
3. Variables: products (array), cart (array), cartCount (number), selectedProduct.
4. Logic: product tap stores the item and navigates to Detail; add-to-cart appends to cart and increments cartCount (bind a badge Text to it); checkout clears cart.
5. Images: generate product/hero art with assetKind "product"/"hero". Verify the tap-through: Home → Detail → add → Cart.`,
  },

  {
    id: '2d-game',
    title: '2D game (built from scratch: custom spec + logic)',
    triggers: ['game', 'flappy', 'angry birds', 'slingshot', 'runner', 'jump', 'arcade', 'platformer'],
    instructions: `PLAYBOOK 2d-game — author the game YOURSELF (no templates), then wire the app logic around it:
1. Art first: generate_sprite per key entity (one subject, no background → transparent PNG). Keep one coherent art style across prompts. Note each returned file path.
2. Author a FULL custom GameSceneSpec and pass it as \`spec\` to create_game_scene. Design coords: top-left origin, +y down. The shape:
   {"width":390,"height":844,"backgroundColor":"#7EC8E3","gravity":-18,"startPaused":true,"showScore":true,
    "entities":[
     {"id":"ground","x":0,"y":800,"width":390,"height":44,"color":"#C9A44C","body":"staticBody","category":"ground"},
     {"id":"player","sprite":"<path from generate_sprite>","x":90,"y":380,"width":48,"height":44,"body":"dynamic","circleBody":true,"category":"player","contacts":["obstacle","ground"],
      "behaviors":[{"type":"impulseOnTap","strength":9},{"type":"onCollision","target":"obstacle","action":"gameOver"},{"type":"onCollision","target":"ground","action":"gameOver"}]},
     {"id":"obstacle","sprite":"<path>","x":0,"y":0,"width":64,"height":300,"body":"kinematic","category":"obstacle","isTemplate":true},
     {"id":"spawner","x":0,"y":0,"width":1,"height":1,"body":"none",
      "behaviors":[{"type":"spawner","template":"obstacle","interval":2.0,"velocityX":-150,"gapSize":180,"spawnYMin":300,"spawnYMax":640}]}]}
   Behavior vocabulary: impulseOnTap(strength), spawner(template,interval,velocityX,gapSize,spawnYMin/Max), moveConstant(velocityX/Y), destroyOffscreen(margin), onCollision(target, action: gameOver|score|win|removeSelf|removeOther|damage|bounce, points), slingshot(maxPower,maxDrag), destructible(particles), wrapVertical. \`isTemplate:true\` entities are spawned, not placed. Missing fields default sensibly — but design every entity deliberately.
3. Tune: gravity more negative = heavier; spawner interval/gap = difficulty; winScore for a win state; difficultyRamp 0.9 ramps spawners 10% faster every 10s; lives:3 for a hearts HUD; timeLimit + timeUpAction "win" for survival modes.
3b. PICK THE RIGHT GENRE — the engine does all of these from scratch (never default to flappy):
   • Breakout/Arkanoid: gravity 0; ball = dynamic circle, restitution 1, friction 0, damping 0, impulseOnTap to launch, onCollision brick→removeOther+points; paddle = kinematic + controlHorizontal; static walls; winScore = brick count.
   • Platformer/runner: gravity -25; hero jumpOnTap; cameraFollow + worldWidth for side-scroll; patrol enemies; coins = onCollision→removeSelf+score.
   • Shooter: player controlHorizontal + shootOnTap(projectile template); spawner enemies from top (velocityY); enemy onCollision projectile→explode+points.
   • Slingshot/physics: slingshot + destructible stack + health.
   • Survival: timeLimit + timeUpAction "win" + difficultyRamp.
4. JUICE (use several — flat scenes feel dead): backgroundGradient + vignette + lighting:true with lightFollow on the player (normal-mapped shading — kills the flat look), dropShadow/glow per entity; entity \`frames\` + frameRate for sprite animation; rotateWithVelocity on the player (Flappy tilt); trail(particles "spark"/"fire") on fast movers; onCollision shake:true + particles on impacts; parallax background layers (speed 0.2/0.5/0.8) for depth; ambient "snow"/"stars" for atmosphere; cameraFollow + worldWidth for side-scrollers. Other controls: jumpOnTap (platformer), controlHorizontal (steer), shootOnTap (projectiles), patrol/followEntity (enemies).
5. Screens + LOGIC around the game (this part is NOT optional): a menu screen (title + Play button) and the game screen hosting the scene; wire Play → navigate to game screen with apply_logic_actions, plus any score/state variables the app needs. In the preview the game auto-syncs gameScore/gameOver/gameWon variables — bind Texts to them for score UI outside the game; onCollision runFlow(flowId:"flow name") fires real logic flows.
6. Verify: get_game_scene (spec round-trips), get_screenshot (poster renders with your sprites), get_logic_flows (navigation exists), preview_tap the Play button.`,
  },

  {
    id: 'dashboard',
    title: 'Dashboard / analytics / tracker',
    triggers: ['dashboard', 'analytics', 'tracker', 'stats', 'habit', 'fitness', 'health', 'budget', 'finance'],
    instructions: `PLAYBOOK dashboard:
1. Home = summary cards (2-col grid of stat tiles: big number + label), one hero metric up top, a recent-activity list below (repeat-bound).
2. Variables per metric (numbers), bound to the stat Text nodes — so logic updates move the UI.
3. An "add entry" screen or sheet-style frame: inputs → increment/append flows → navigate back. onScreenLoad flows seed demo data so the dashboard never renders empty.
4. Keep the palette calm (one accent via set_brand); numbers get the display font size, labels stay small.
5. Verify: preview_tap the add-entry path and confirm the bound numbers change (get_logic_flows + preview_screenshot).`,
  },

  {
    id: 'onboarding',
    title: 'Onboarding / walkthrough',
    triggers: ['onboarding', 'walkthrough', 'welcome', 'intro', 'tutorial', 'first run'],
    instructions: `PLAYBOOK onboarding:
1. 2–3 swipeable-feel screens: full-bleed illustration (generated, assetKind "hero"), one headline, one line of copy, page dots (3 small circles, active one in accent), Next/Skip.
2. Next navigates to the following onboarding screen; Skip and the last screen's CTA both navigate to Home. Wire ALL of them.
3. Variable hasOnboarded set true on completion; Home's onScreenLoad can branch on it later.
4. Keep each screen visually consistent: same layout skeleton, different image + copy.
5. Verify the full tap-through: screen 1 → 2 → 3 → Home, and Skip → Home.`,
  },
];

export const SkillLibrary = {
  all,

  /** `skill(withId:)` */
  skill(id: string): AgentSkill | undefined {
    return all.find((skill) => skill.id === id.toLowerCase());
  },

  /** Skills whose triggers appear in the goal (max `limit`, stable order). */
  matching(goal: string, limit = 2): AgentSkill[] {
    const lower = goal.toLowerCase();
    return all.filter((skill) => skill.triggers.some((trigger) => lower.includes(trigger))).slice(0, limit);
  },

  get catalogSummary(): string {
    return all.map((skill) => `- ${skill.id}: ${skill.title}`).join('\n');
  },
} as const;
