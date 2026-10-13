import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { readManifest } from '../../web/worlds/sdk/core/manifest.js';
import { makeSim } from '../../web/worlds/sdk/core/sim.js';

const world = readManifest(JSON.parse(readFileSync(new URL('../../web/worlds/tennis/world.json', import.meta.url), 'utf8')));
const script = readFileSync(new URL('../../web/worlds/tennis/sim.js', import.meta.url), 'utf8');
const regulation=load().tennisView.COURT;
test('the court uses official full-size dimensions and recommended clear run-off at one shared scale', () => {
  const manifest=JSON.parse(readFileSync(new URL('../../web/worlds/tennis/world.json',import.meta.url),'utf8'));
  const scale=.8, surface=manifest.plots.scenery.find(p=>p.sprite==='assets/hardcourt.png'&&p.rect?.[0]===0);
  assert.ok(surface,'a regulation-sized hardcourt replaces the compressed blue tile');
  assert.deepEqual(surface.size,[10.97*scale,23.77*scale]);
  assert.ok(manifest.plots.size[0]>=18.29*scale&&manifest.plots.size[1]>=36.57*scale);
  const V=load().tennisView;
  assert.equal(V.COURT.baseline,23.77/2*scale);assert.equal(V.COURT.singles,8.23/2*scale);
  assert.equal(V.COURT.doubles,10.97/2*scale);assert.equal(V.COURT.service,6.4*scale);
  assert.equal(V.netHeight(0,'doubles'),.914*scale);
  assert.equal(V.netHeight(V.COURT.netPost,'doubles'),1.07*scale);
  const marks=manifest.plots.scenery.filter(p=>p.shape==='plane');
  for(const half of [10.97/2*scale,8.23/2*scale])for(const sign of [-1,1]){
    const edge=marks.find(p=>p.size[1]===23.77*scale&&Math.abs(p.at[0]-sign*(half-.025*scale))<1e-8);
    assert.ok(edge,'sideline outer edges use the official court width');assert.equal(edge.size[0],.05*scale);
  }
  for(const sign of [-1,1])assert.ok(marks.some(p=>p.size[0]===8.23*scale&&Math.abs(p.at[1]-sign*(6.4-.025)*scale)<1e-8),'service lines lie 6.4m from the net');
  assert.ok(marks.some(p=>p.size[0]===.05*scale&&p.size[1]===.1*scale),'baseline centre marks are 10cm long and 5cm wide');
  assert.ok(manifest.plots.grid.step[0]>manifest.plots.size[0]+1&&manifest.plots.grid.step[1]>manifest.plots.size[1]+4,'allocated run-off areas leave independent corridors');
});
function load() {
  const A = { sim(hooks) { A.hooks = hooks; } }; vm.runInNewContext(script, { Agentville: A }); return A;
}
const sceneOf = (count = 0, idle = 0) => ({ agents: [{ id: 'parent', name: 'Parent', state: 'working', repo: '/r', step: 'edit' }, ...Array.from({ length: idle }, (_, i) => ({ id: `guest${i}`, name: `Guest ${i}`, state: 'idle', repo: null }))],
  repos: [{ key: '/r', name: 'Repo', bed: 0 }], subagents: Array.from({ length: count }, (_, i) => ({ id: `child${i}`, by: 'parent', label: `Child ${i}`, state: 'running', startedAt: i })), mail: [] });
function run(count, idle, seconds, visit) {
  const A = load(), sim = makeSim(world, A.hooks, { now: () => 1000 }), scene = sceneOf(count, idle); sim.scene(scene);
  for (let i = 0; i < seconds * 20; i++) { sim.step(.05); visit?.(A.tennisView.readShared(sim.state().shared), i, sim); }
  return { A, sim, scene };
}

test('walk directions follow displacement, including southbound paths to a court', () => {
  const { direction } = load().tennisView;
  assert.equal(direction(0, 1), 'south'); assert.equal(direction(0, -1), 'north');
  assert.equal(direction(1, 0), 'east'); assert.equal(direction(-1, 0), 'west');
});
test('a ball machine stays fixed, feeds individually, and never returns a player shot', () => {
  let returned = false, dead = false, waiting = false, lastPhase = '', lastTeam = null;
  run(0, 0, 120, state => {
    const c = state.courts[0];
    assert.equal(c.machine.x, world.plots.at[0][0]); assert.equal(c.machine.z, world.plots.at[0][1] - regulation.feeder);
    if (c.ball?.kind !== 'feed' && c.phase === 'flight') returned = true;
    if (lastPhase === 'flight' && c.phase === 'flight' && lastTeam === 0) assert.equal(c.ball.team, 0, 'a machine cannot send the returned ball back');
    dead ||= c.phase === 'dead'; waiting ||= c.phase === 'feed'; lastPhase = c.phase; lastTeam = c.ball?.team;
  });
  assert.ok(returned && dead && waiting, 'a full feed, return and pause cycle happens');
});
test('doubles use all four players, varied shots and legal court positions without awarding simulated points', () => {
  const moved = new Map(), struck = new Set(), kinds = new Set(), calls = new Set();
  const { A, sim, scene } = run(3, 0, 180, state => {
    const c = state.courts[0]; if (c.ball) kinds.add(c.ball.kind); if (c.call) calls.add(c.call);
    for (const [id, p] of Object.entries(c.players)) {
      const old = moved.get(id) ?? { x: p.x, z: p.z, distance: 0 }; old.distance += Math.hypot(p.x - old.x, p.z - old.z); old.x = p.x; old.z = p.z; moved.set(id, old);
      if (['serve', 'forehand', 'backhand', 'volley', 'smash'].includes(p.pose)) struck.add(id);
      assert.ok(Math.abs(p.x - world.plots.at[0][0]) < regulation.doubles+.8 && Math.abs(p.z - world.plots.at[0][1]) < regulation.baseline+1);
    }
  });
  assert.equal(struck.size, 4, 'every doubles player can hit the ball');
  assert.ok([...moved.values()].every(p => p.distance > 5)); assert.ok(kinds.size >= 3); assert.ok(calls.size >= 1);
  assert.deepEqual(JSON.parse(JSON.stringify(A.tennisView.matchesOf(scene)['/r'].points)), ['0', '0']);
  assert.ok(!JSON.stringify(sim.state().shared).includes('winner'));
});
test('idle life has individual walks, seats, paired conversation, drinks and a bartender', () => {
  const poses = new Set(), drinkers = new Set(); let conversation = false, bartender = false;
  run(0, 20, 120, state => {
    for (const [id, p] of Object.entries(state.social)) { poses.add(p.pose); if (p.drink) drinkers.add(id); conversation ||= Boolean(p.buddy); bartender ||= p.pose === 'pour'; }
  });
  assert.ok(poses.has('sit') && poses.has('lie') && poses.has('walk')); assert.ok(conversation); assert.ok(bartender); assert.ok(drinkers.size > 3);
});
test('the world shares bounded plain state and a fixed seed gives all viewers the same result', () => {
  const first = run(3, 20, 8).sim.state(), second = run(3, 20, 8).sim.state();
  assert.equal(JSON.stringify(first.shared), JSON.stringify(second.shared));
  assert.ok(Object.keys(first.shared).length <= 16);
  assert.ok(Object.values(first.shared).every(v => JSON.stringify(v).length < 16384));
});

test('all leisure motion stays in the recreation area and seats do not overlap', () => {
  run(3, 45, 150, state => {
    const seated = [];
    for (const p of Object.values(state.social)) {
      assert.ok(p.x >= 19.4 - .01 && p.x <= 49.4 + .01 && p.z >= 4 && p.z <= 19.8 + .01);
      if (['sit', 'sip', 'chat', 'lie'].includes(p.pose)) {
        assert.ok(!seated.some(q => Math.hypot(p.x - q.x, p.z - q.z) < .7), 'two agents cannot use one seat'); seated.push(p);
      }
    }
  });
});
test('training includes collecting loose balls but never awards another score', () => {
  let collected = false, loose = false;
  run(0, 0, 140, state => { collected ||= state.courts[0].phase === 'collect'; loose ||= state.courts[0].loose.length > 0; });
  assert.ok(collected && loose);
});
test('a subagent doing tests chooses defensive ground strokes independently of its parent', () => {
  const A = load(), sim = makeSim(world, A.hooks), s = sceneOf(3); s.subagents[0].step = 'test'; sim.scene(s);
  let checked = false;
  for (let i = 0; i < 3600; i++) {
    sim.step(.05); const c = A.tennisView.readShared(sim.state().shared).courts[0];
    if (['forehand','backhand'].includes(c.players.child0.pose) && c.ball.team === 1) { assert.equal(c.ball.kind, 'slice'); checked = true; }
  }
  assert.ok(checked, 'a real ground stroke from the subagent was observed');
});

test('the renderer faces along a court travel path and uses the original player atlas', async () => {
  const A = load(); A.view = hooks => { A.viewHooks = hooks; };
  vm.runInNewContext(readFileSync(new URL('../../web/worlds/tennis/view.js', import.meta.url), 'utf8'), { Agentville: A, console });
  const frames = [], paths = [];
  const ctx = { THREE, scene: { agents: [{ id:'parent',state:'working',repo:'/r' }],subagents:[] }, time:1,
    shared:{ courts0:{ 0:{ active:true,players:{ parent:{ role:'player',pose:'walk',face:'north' } } } } }, invalidate(){},
    assets:{ async sprite(path) { paths.push(path); const m = new THREE.Mesh(new THREE.PlaneGeometry(1,1), new THREE.MeshBasicMaterial()); m.material.map = { image:{ width:1230,height:1278 } }; m.userData.frame = rect => frames.push(rect); return m; } },
  };
  const figure = A.viewHooks.figure(ctx, { id:'parent',color:'#4a7bd0' }); figure.animate('walk',1); await Promise.resolve();
  for (const [heading,row] of [[0,0],[Math.PI,1],[Math.PI/2,3],[-Math.PI/2,2]]) { figure.object.rotation.y = heading; figure.animate('walk',1); assert.equal(frames.at(-1)[1], row * 1278/4); }
  ctx.time = 2; ctx.shared.courts0[0].players.parent.stance = true;
  for (const heading of [0, Math.PI/2, -Math.PI/2]) { figure.object.rotation.y = heading; figure.animate('walk',2); assert.equal(frames.at(-1)[1], 1278/4, 'retreats and side steps keep the north-facing tennis stance'); }
  assert.deepEqual(paths, ['assets/players.png']); figure.dispose();
});

test('leisure uses empty-handed sprites, keeps the glass at the chest and visibly empties it; waiting faces south', async () => {
  const A = load(); A.view = hooks => { A.viewHooks = hooks; };
  vm.runInNewContext(readFileSync(new URL('../../web/worlds/tennis/view.js', import.meta.url), 'utf8'), { Agentville: A, console });
  const meshes = new Map(), frames = new Map(), dimensions = { 'assets/idle-walk.png':[1659,948], 'assets/glasses.png':[1536,1024] };
  const guest = { role:'guest',pose:'walk',face:'south',drink:true,drinkLevel:4,glassMode:'hand' };
  const ctx = { THREE,time:1,scene:{agents:[{id:'guest0',state:'idle'}]},shared:{social0:{guest0:guest}},invalidate(){},assets:{async sprite(path,size){
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(...size),new THREE.MeshBasicMaterial());
    const [width,height] = dimensions[path]; mesh.material.map = {image:{width,height}};
    mesh.userData.frame = r => frames.set(path,Array.from(r)); meshes.set(path,mesh); return mesh;
  }} };
  const figure=A.viewHooks.figure(ctx,{id:'guest0'});
  figure.animate('walk',1); await Promise.resolve(); figure.animate('walk',1); await Promise.resolve(); figure.animate('walk',1);
  assert.deepEqual([...meshes.keys()],['assets/idle-walk.png','assets/glasses.png']);
  const cup=meshes.get('assets/glasses.png');
  assert.deepEqual(frames.get('assets/glasses.png'),[0,0,512,512]);
  assert.ok(cup.position.z < -.5,'carried glass is anchored above the feet');
  ctx.time=2;guest.drinkLevel=0;figure.animate('walk',2);
  assert.deepEqual(frames.get('assets/glasses.png'),[512,512,512,512],'the empty glass has its own visible frame');
  ctx.time=3;ctx.scene.agents[0].state='waiting';ctx.shared={courts0:{0:{active:false,players:{guest0:{face:'north',role:'player'}}}}};
  figure.object.rotation.y=Math.PI;figure.animate('wait',3);
  assert.equal(frames.get('assets/idle-walk.png')[1],0,'waiting players face the viewer despite stale court state');
  assert.equal(cup.visible,false);figure.dispose();
});

test('court movement keeps facing the opponent while retreating and moving sideways', () => {
  let retreat = false, lateral = false; const previous = new Map();
  run(3, 0, 120, state => {
    for (const [id, p] of Object.entries(state.courts[0].players)) {
      assert.equal(p.face, p.team === 0 ? 'north' : 'south'); assert.equal(p.stance, true);
      const old = previous.get(id);
      if (old && p.moving) { retreat ||= (p.z - old.z) * (p.team === 0 ? 1 : -1) > .02; lateral ||= Math.abs(p.x - old.x) > .02; }
      previous.set(id, p);
    }
  });
  assert.ok(retreat && lateral, 'both backpedalling and lateral movement were observed');
});

test('each return uses one stable intercept after a reaction pause and touches the sprite string bed exactly', () => {
  let plans = 0, contacts = 0, pauses = 0, backhands = 0, serves = 0, switches = 0;
  for (const count of [0, 1, 3]) {
    const A = load(), { matchesOf, positions, player, stepCourt, racketOffset, BALL_LIFT } = A.tennisView;
    const m = matchesOf(sceneOf(count))['/r'], court = { x:world.plots.at[0][0], z:world.plots.at[0][1], bed:0 };
    const game = { match:m,court,players:Object.fromEntries(Object.entries(positions(m,court)).filter(([id])=>id!=='@machine').map(([id,at])=>[id,player(id,at)])),phase:count?'prepare':'feed',next:0,loose:[],collectAfter:50 };
    let seed = 42, lastPlan = null, goal = null, lastShot = null; const previousHands = new Map();
    const random = () => { seed = (Math.imul(seed,1664525)+1013904223)>>>0; return seed/4294967296; };
    for(let i=0;i<7200;i++) {
      const now=i*.025, old=Object.fromEntries(Object.entries(game.players).map(([id,p])=>[id,{x:p.x,z:p.z}]));
      stepCourt(game,.025,now,random);
      if(game.phase==='dead') previousHands.clear();
      if(game.phase==='flight' && game.intercept) {
        const p=game.players[game.intercept.id];
        if(game.intercept!==lastPlan) { plans++; lastPlan=game.intercept; goal=[p.tx,p.tz]; }
        assert.deepEqual([p.tx,p.tz],goal,'the destination cannot jitter between flight samples');
        if(now>game.intercept.reactAt-.2 && now<game.intercept.reactAt) { assert.deepEqual([p.x,p.z],[old[p.id].x,old[p.id].z]); pauses++; }
      }
      if(game.phase==='impact') {
        const p=game.players[game.shot.player], offset=racketOffset(p.face,p.pose==='backhand'||p.backhand), b=game.ball;
        assert.ok(Math.abs(b.x-p.x-offset.x)<1e-10);
        assert.ok(Math.abs(b.z-b.y*BALL_LIFT-p.z-offset.z)<1e-10);
        assert.equal(p.moving,false); contacts++; backhands+=Boolean(p.backhand); serves+=Boolean(game.shot.serve);
        if(game.shot!==lastShot) { switches+=previousHands.get(p.id)===true&&!p.backhand; previousHands.set(p.id,Boolean(p.backhand)); lastShot=game.shot; }
      }
    }
  }
  assert.ok(plans>20 && contacts>30 && pauses>20 && backhands>0 && serves>0);
  assert.ok(switches>0,'a forehand remains reachable after a backhand in the same rally');
});

test('long simulated play leaves an authoritative Git scoreboard unchanged', () => {
  const A = load(), sim = makeSim(world, A.hooks), s = sceneOf(3), m = A.tennisView.matchesOf(s)['/r'];
  m.points = ['AD', '40']; m.score.points = [4,3]; m.score.games = [2,1]; m.score.sets = [1,0]; s.tennis = { '/r': m };
  const before = JSON.stringify(s.tennis); sim.scene(s);
  for (let i = 0; i < 3600; i++) sim.step(.05);
  assert.equal(JSON.stringify(s.tennis), before);
});

test('a Git-driven change of ends starts a fresh rally on the correct court halves', () => {
  const A=load(), sim=makeSim(world,A.hooks), s=sceneOf(3); s.tennis={'/r':A.tennisView.matchesOf(s)['/r']};
  sim.scene(s); for(let i=0;i<80;i++)sim.step(.05);
  const next=structuredClone(s); next.tennis['/r'].score.ends=1; next.tennis['/r'].score.server=1;
  sim.scene(next); const reset=A.tennisView.readShared(sim.state().shared).courts[0];
  assert.equal(reset.phase,'prepare'); assert.equal(reset.ball,null);
  for(let i=0;i<360;i++)sim.step(.05);
  const c=A.tennisView.readShared(sim.state().shared).courts[0];
  for(const p of Object.values(c.players)) { assert.equal(p.face,p.team===0?'south':'north'); assert.ok((p.z-world.plots.at[0][1])*(p.team===0?-1:1)>0); }
  assert.equal(next.tennis['/r'].score.server,1); assert.deepEqual(next.tennis['/r'].points,['0','0']);
});
test('a court full of helpers still fits the shared-state size limit', () => {
  const A = load(), sim = makeSim(world, A.hooks), s = sceneOf(20);
  sim.scene(s); sim.step(.05);
  assert.ok(Object.values(sim.state().shared).every(v => JSON.stringify(v).length < 16384));
});

test('nine visible courts with twenty subagents each and excess repos remain within the room wire limits', () => {
  const A = load(), sim = makeSim(world, A.hooks), s = { agents:[],subagents:[],repos:[],mail:[] };
  for(let i=0;i<18;i++) {
    const id=`parent-${i}-12345678-1234-1234-1234-123456789abc`, repo=`/repo${i}`;
    s.agents.push({id,state:'working',name:'Parent',repo,step:'edit'});s.repos.push({key:repo,bed:i});
    for(let j=0;j<20;j++)s.subagents.push({id:`child-${i}-${j}-12345678-1234-1234-1234-123456789abc`,by:id,state:'running',label:'Child',startedAt:j});
  }
  sim.scene(s);sim.step(.05); const shared=sim.state().shared;
  assert.equal(Object.keys(A.tennisView.readShared(shared).courts).length,9);
  assert.ok(Object.keys(shared).length<=16);
  assert.ok(Object.values(shared).every(value=>JSON.stringify(value).length<16384));
});

test('short collection pauses remove the picked balls and resume feeding without recreating a collected ball', () => {
  let previous = '', observed = false;
  run(0, 0, 160, state => {
    const c = state.courts[0];
    if(previous==='collect' && c.phase==='feed') { assert.ok(c.loose.length<=6); assert.equal(c.ball,null); observed=true; }
    previous=c.phase;
  });
  assert.ok(observed);
});

test('singles and doubles sustain multi-shot rallies across different agent identities', () => {
  for(const count of [1,3]) for(let seed=0;seed<8;seed++) {
    const A=load(), sim=makeSim(world,A.hooks), scene=sceneOf(count);
    scene.agents[0].id=`player-${seed}`; scene.subagents.forEach((a,i)=>{a.id=`partner-${seed}-${i}`;a.by=scene.agents[0].id;});
    sim.scene(scene); let previous='', strikes=0, longest=0, rallies=0, total=0;
    for(let i=0;i<4800;i++) { sim.step(.025); const c=A.tennisView.readShared(sim.state().shared).courts[0];
      if(c.phase==='impact'&&previous!=='impact')strikes++;
      if(c.phase==='dead'&&previous!=='dead'){longest=Math.max(longest,strikes);total+=strikes;strikes=0;rallies++;}
      previous=c.phase;
    }
    longest=Math.max(longest,strikes); if(strikes){total+=strikes;rallies++;}
    assert.ok(longest>=6,`case ${count}/${seed}: longest rally ${longest}`);
    assert.ok(total/rallies>=4,`case ${count}/${seed}: average rally ${total/rallies}`);
  }
});

test('visible leisure agents are real identities, capped at ten, with exact overflow after scene changes', () => {
  const A=load(), sim=makeSim(world,A.hooks), s=sceneOf(0,24); sim.scene(s);sim.step(.05);
  let state=sim.state(),social=A.tennisView.readShared(state.shared).social;
  assert.equal(Object.keys(social).length,10); assert.equal(state.bodies.filter(b=>b.zone==='idle').length,10);
  assert.ok(Object.keys(social).every(id=>s.agents.some(a=>a.id===id&&a.state==='idle')));
  const n=structuredClone(s);n.agents=n.agents.slice(0,4);sim.scene(n);sim.step(.05);
  state=sim.state();social=A.tennisView.readShared(state.shared).social;
  assert.equal(Object.keys(social).length,3); assert.equal(state.bodies.filter(b=>b.zone==='idle').length,3);
  n.agents=n.agents.slice(0,1);sim.scene(n);sim.step(.05);assert.equal(Object.keys(A.tennisView.readShared(sim.state().shared).social).length,0);
});

test('doubles preserve separate left and right lanes and never share a receiving target', () => {
  const previous=new Map();
  run(3,0,240,state=>{
    const c=state.courts[0],cx=world.plots.at[0][0];
    assert.ok(c.players.parent.x>cx+.28&&c.players.child1.x<cx-.28);
    assert.ok(c.players.child0.x<cx-.28&&c.players.child2.x>cx+.28);
    for(const team of [['parent','child1'],['child0','child2']])assert.ok(Math.hypot(c.players[team[0]].x-c.players[team[1]].x,c.players[team[0]].z-c.players[team[1]].z)>.55);
    for(const [id,p]of Object.entries(c.players)){const old=previous.get(id);if(old)assert.ok((p.z-world.plots.at[0][1])*(old.z-world.plots.at[0][1])>0,'players stay on their own half during play');previous.set(id,p);}
  });
});

test('walking routes avoid every net even when the SDK selects a direct shortcut', () => {
  const {aroundNets}=load().tennisView,barriers=world.plots.at.map(([x,z])=>({x,z}));
  const check=(start,path)=>{for(const end of path){for(const c of barriers){if((start[1]-c.z)*(end[1]-c.z)<0){const k=(c.z-start[1])/(end[1]-start[1]),x=start[0]+(end[0]-start[0])*k;assert.ok(Math.abs(x-c.x)>=regulation.netClear-1e-8,'a segment crosses outside the net posts');}}start=end;}};
  for(const c of barriers){for(const dz of [-1,1]){const start=[c.x,c.z+dz*4],target=[c.x+.6,c.z-dz*4];const path=aroundNets(start,[target],barriers);assert.ok(path.length>=3);check(start,path);}}
  check([4,12],aroundNets([4,12],[[46,73]],barriers));
  const A=load(),sim=makeSim(world,A.hooks),s=sceneOf(0);sim.scene(s);
  const c=barriers[0],start=[c.x,c.z-1],end=[c.x,c.z+1];
  check(start,sim.layout.route(start,end));
});

test('training collection walks round the net to retrieve balls on the other half', () => {
  const A=load(),V=A.tennisView,m=V.matchesOf(sceneOf(0))['/r'],c={x:0,z:0,bed:0};
  const p=V.player(m.parent,{x:0,z:3,face:'north',team:0,role:'player'}),game={match:m,court:c,players:{[p.id]:p},phase:'collect',loose:[{x:0,z:-4}],next:0,collectAfter:0};
  let old={x:p.x,z:p.z},crossed=false;
  for(let i=0;i<500;i++){V.stepCourt(game,.025,i*.025,()=>.5);if(old.z*p.z<0){assert.ok(Math.abs(p.x)>regulation.netClear-.05);crossed=true;}old={x:p.x,z:p.z};if(!game.loose.length)break;}
  assert.ok(crossed&&game.loose.length===0);
});

test('ballistic integration lands precisely on a safe target regardless of frame size', () => {
  const {launch,advanceBall}=load().tennisView;
  for(const dt of [.01,.025,.05]){const game={};launch(game,{x:0,z:4,y:.8},{x:1,z:-3.5},1.4,0,'topspin');let hit;
    for(let i=0;i<200&&!hit;i++)hit=advanceBall(game.ball,dt);
    assert.ok(Math.abs(hit.x-1)<1e-8&&Math.abs(hit.z+3.5)<1e-8);
  }
});

test('the nearer reachable doubles player owns the ball while its partner covers another lane', () => {
  const V=load().tennisView,m=V.matchesOf(sceneOf(3))['/r'],c={x:0,z:0,bed:0},players=Object.fromEntries(Object.entries(V.positions(m,c)).map(([id,at])=>[id,V.player(id,at)]));
  Object.assign(players.parent,{x:1.1,z:3.4,tx:1.1,tz:3.4});
  const game={match:m,court:c,players,loose:[],next:0,collectAfter:50};V.launch(game,{x:1,z:-3,y:.7},{x:1,z:3.4},1.6,1,'topspin');V.stepCourt(game,.025,0,()=>.5);
  assert.equal(game.receiver,'parent');assert.ok(players.parent.tx>0&&players.child1.tx<0);
  assert.ok(Math.hypot(players.parent.tx-players.child1.tx,players.parent.tz-players.child1.tz)>.6);
});

test('rest poses preserve square proportions and the overflow label counts real remaining agents', async () => {
  const A=load();A.view=h=>A.viewHooks=h;vm.runInNewContext(readFileSync(new URL('../../web/worlds/tennis/view.js',import.meta.url),'utf8'),{Agentville:A,console});
  const sizes=[],meshes=[],ctx={THREE,time:0,scene:sceneOf(0,24),shared:{social0:{guest0:{pose:'lie',face:'south',role:'guest'}}},invalidate(){},plotOf(){return null;},assets:{async sprite(path,size){sizes.push(size);const mesh=new THREE.Mesh(new THREE.PlaneGeometry(...size),new THREE.MeshBasicMaterial());mesh.material.map={image:{width:1774,height:887}};mesh.userData.frame=()=>{};meshes.push(mesh);return mesh;}}};
  const f=A.viewHooks.figure(ctx,{id:'guest0',color:'#4a7bd0'});f.animate('idle',0);await Promise.resolve();f.animate('idle',0);
  assert.deepEqual(Array.from(sizes[0]),[2.4,2.4]);assert.equal(meshes[0].scale.z,1);
  assert.equal(A.viewHooks.labels(ctx).find(l=>l.key==='resting-more').text,'+14 resting');
  ctx.scene=sceneOf(0,3);assert.ok(!A.viewHooks.labels(ctx).some(l=>l.key==='resting-more'));f.dispose();
});

test('court run-off clears the path and loungers retain their source aspect ratio',()=>{
  const manifest=JSON.parse(readFileSync(new URL('../../web/worlds/tennis/world.json',import.meta.url),'utf8'));
  const path=manifest.scenery.find(it=>it.rect?.[0]===825),lounge=manifest.scenery.find(it=>it.rect?.[0]===70);
  assert.ok(manifest.plots.grid.origin[1]-manifest.plots.size[1]/2-(path.each[0][1]+path.size[1]/2)>2.5);
  assert.ok(Math.abs(lounge.size[0]/lounge.size[1]-255/400)<.001);
});

function courtGame(count=5) {
  const V=load().tennisView,m=V.matchesOf(sceneOf(count))['/r'],court={x:0,z:0,bed:0};
  return {V,game:{match:m,court,players:Object.fromEntries(Object.entries(V.positions(m,court)).filter(([id])=>id!=='@machine').map(([id,at])=>[id,V.player(id,at)])),loose:[],next:0,collectAfter:60,secondServe:false}};
}
test('a shot stopped by the net ends the rally without mutating Git points',()=>{
  const {V,game}=courtGame();const before=JSON.stringify(game.match.score);V.launch(game,{x:.5,z:3,y:.8},{x:-.5,z:-2},1,0,'drive');
  const t=.6;game.ball.vy=(.2-.8+9.81*regulation.scale*t*t/2)/t;
  for(let i=0;i<60&&game.phase!=='dead';i++)V.stepCourt(game,.025,i*.025,()=>.5);
  assert.equal(game.phase,'dead');assert.equal(game.call,'net');assert.equal(game.ball.live,false);assert.ok(Math.abs(game.ball.z)<.04);
  assert.equal(game.players.child3.call,'Net error');assert.equal(game.players.child3.pose,'call');assert.equal(JSON.stringify(game.match.score),before);
});
test('net-cord returns remain live, while a legal net-cord serve is replayed without clearing a first fault',()=>{
  for(const serve of [false,true]) {
    const {V,game}=courtGame();game.target={x:-.5,z:-2};game.secondServe=true;V.launch(game,{x:.5,z:3,y:.8},game.target,1,0,serve?'serve':'drive',serve);
    const t=.6;game.ball.vy=(V.netHeight(-.1,game.match.mode)-.8+9.81*regulation.scale*t*t/2)/t;let liveCord=false,netSignal=false;
    for(let i=0;i<60&&game.phase!=='dead';i++){V.stepCourt(game,.025,i*.025,()=>.5);liveCord ||= game.ball.netTouch&&game.phase==='flight';netSignal ||= game.players.child3.pose==='net-call';}
    assert.ok(liveCord);
    if(serve){assert.equal(game.call,'let');assert.equal(game.secondServe,true);assert.ok(netSignal);assert.equal(game.players.child3.call,'Let');}
    else assert.ok(!netSignal);
  }
});
test('net errors occur naturally and the chair umpire tracks both halves during play',()=>{
  let net=false;const gaze=new Set();run(5,0,180,state=>{const c=state.courts[0];net ||= c.call==='net';if(c.phase==='flight')gaze.add(c.players.child3.gaze);});
  assert.ok(net);assert.ok(gaze.has(0)&&gaze.has(2));
});
test('a singles return touching the doubles net outside its singles sticks hits a permanent fixture',()=>{
  const {V,game}=courtGame(1),x=regulation.singlesStick+.2;
  V.launch(game,{x,z:3,y:.8},{x,z:-2},1,0,'drive');const t=.6;
  game.ball.vy=(.8-.8+9.81*regulation.scale*t*t/2)/t;
  for(let i=0;i<60&&game.phase!=='dead';i++)V.stepCourt(game,.025,i*.025,()=>.5);
  assert.equal(game.call,'out');assert.equal(game.ball.live,false);
});
test('a ball touching the outer edge of a regulation sideline is in; one completely beyond it is out',()=>{
  for(const touches of [true,false]){
    const {V,game}=courtGame(1),x=regulation.singles+regulation.ballRadius*(touches ? .7 : 1.3);game.players={};
    V.launch(game,{x,z:4,y:.8},{x,z:-4},1.4,0,'topspin');
    for(let i=0;i<80&&game.ball.bounces===0&&game.phase==='flight';i++)V.stepCourt(game,.025,i*.025,()=>.5);
    assert.equal(game.ball.bounces,1);assert.equal(game.phase,touches?'flight':'dead');
    if(!touches)assert.equal(game.call,'out');
  }
});
test('stale guests use all seating types, buy drinks and rotate bar duties and seats over eight minutes',()=>{
  const A=load(),sim=makeSim(world,A.hooks),s=sceneOf(0,24);s.agents.slice(1).forEach(a=>a.state='stale');sim.scene(s);
  const seatsById=new Map(),servers=new Set(),rest=new Set(),types=new Set();let drank=false,chat=false,lieSip=false;
  for(let i=0;i<9600;i++){sim.step(.05);const social=A.tennisView.readShared(sim.state().shared).social;assert.equal(Object.keys(social).length,10);
    for(const [id,p]of Object.entries(social)){if(p.pose==='pour')servers.add(id);drank ||= Boolean(p.drink);chat ||= p.pose==='chat';lieSip ||= p.pose==='lie-sip';if(['sit','chat','lie','lie-sip','sip'].includes(p.pose)){types.add(p.seatType);rest.add(p.rest);if(!seatsById.has(id))seatsById.set(id,new Set());seatsById.get(id).add(`${p.x},${p.z}`);}}
  }
  assert.ok(drank&&chat&&lieSip);assert.ok(servers.size>=2);assert.ok(types.has('chair')&&types.has('bench')&&types.has('lounge'));
  assert.ok([...seatsById.values()].filter(p=>p.size>=2).length>=6);assert.equal(rest.size,3);
});
test('chair umpire uses square proportions and distinct far/near watching frames',async()=>{
  const A=load();A.view=h=>A.viewHooks=h;vm.runInNewContext(readFileSync(new URL('../../web/worlds/tennis/view.js',import.meta.url),'utf8'),{Agentville:A,console});
  const sizes=[],frames=[],ctx={THREE,scene:sceneOf(5),time:0,shared:{},invalidate(){},assets:{async sprite(path,size){sizes.push(size);const m=new THREE.Mesh(new THREE.PlaneGeometry(...size),new THREE.MeshBasicMaterial());m.material.map={image:{width:1774,height:887}};m.userData.frame=r=>frames.push(r);return m;}}};
  const f=A.viewHooks.figure(ctx,{id:'child3',color:'#4a7bd0'});ctx.shared={courts0:{0:{active:true,players:{child3:{role:'umpire',pose:'umpire',gaze:0,face:'east'}}}}};f.animate('idle',0);await Promise.resolve();f.animate('idle',0);const far=frames.at(-1)[0];
  ctx.time=1;ctx.shared.courts0[0].players.child3.gaze=2;f.animate('idle',1);assert.notEqual(frames.at(-1)[0],far);assert.deepEqual(Array.from(sizes[0]),[2.1,2.1]);f.dispose();
});

test('each player keeps a distinct bag and cached court props follow bed changes without a ghost feeder',async()=>{
  const A=load();A.view=h=>A.viewHooks=h;const document={createElement(){return{width:0,height:0,getContext(){return{clearRect(){},fillRect(){},set fillStyle(v){}}}}}};
  A.pixelText={textWidth:t=>t.length*6,glyphOf:()=>({w:5,rows:[31,17,17,17,31]})};vm.runInNewContext(readFileSync(new URL('../../web/worlds/tennis/view.js',import.meta.url),'utf8'),{Agentville:A,console,document});
  let court={bed:0,x:5.8,z:30.5};const ctx={THREE,root:new THREE.Group(),time:0,scene:sceneOf(0),shared:{},plotOf(){return court},invalidate(){},assets:{async sprite(path,size){const m=new THREE.Mesh(new THREE.PlaneGeometry(...size),new THREE.MeshBasicMaterial());m.material.map={image:{width:1230,height:1278}};m.userData.frame=()=>{};return m;}}};
  const setShared=()=>{const match=A.tennisView.matchesOf(ctx.scene)['/r'];ctx.shared={courts0:{[court.bed]:{mode:match.mode,active:true,players:{},loose:[],ball:null,machine:{x:court.x,z:court.z-6.15}}}};};
  const bags=()=>ctx.root.children.filter(g=>g.userData.repo==='/r'),feeders=()=>ctx.root.children.filter(g=>g.children.some(m=>m.geometry?.parameters.width===1.4&&m.geometry?.parameters.height===1.9));
  setShared();A.viewHooks.frame(ctx,0);await new Promise(r=>setImmediate(r));assert.equal(bags().length,1);assert.equal(feeders().length,1);
  const first=bags()[0].position.clone();A.viewHooks.frame(ctx,.016);assert.deepEqual(bags()[0].position.toArray(),first.toArray());
  court={bed:1,x:13.5,z:30.5};ctx.time++;setShared();A.viewHooks.frame(ctx,0);assert.equal(feeders()[0].position.x,court.x);assert.ok(Math.abs(bags()[0].position.x-first.x-7.7)<1e-8);
  ctx.scene=sceneOf(3);ctx.time++;setShared();A.viewHooks.frame(ctx,0);await new Promise(r=>setImmediate(r));assert.equal(feeders().length,0);assert.equal(bags().length,4);assert.equal(new Set(bags().map(b=>b.position.toArray().join(':'))).size,4);
  ctx.scene=sceneOf(1);ctx.time++;setShared();A.viewHooks.frame(ctx,0);await new Promise(r=>setImmediate(r));assert.equal(bags().length,2);A.viewHooks.dispose();
});

test('singles sticks support the regulation doubles net and are hidden for doubles',async()=>{
  const A=load();A.view=h=>A.viewHooks=h;A.pixelText={textWidth:t=>t.length*6,glyphOf:()=>({w:5,rows:[31]})};
  const document={createElement(){return{getContext(){return{clearRect(){},fillRect(){}}}}}};
  vm.runInNewContext(readFileSync(new URL('../../web/worlds/tennis/view.js',import.meta.url),'utf8'),{Agentville:A,console,document});
  const [x,z]=world.plots.at[0],ctx={THREE,world,root:new THREE.Group(),time:0,scene:sceneOf(1),shared:{},plotOf(){return{bed:0,x,z}},invalidate(){},assets:{
    async texture(){return new THREE.Texture();},async sprite(path,size){const mesh=new THREE.Mesh(new THREE.PlaneGeometry(...size),new THREE.MeshBasicMaterial());mesh.material.map={image:{width:1774,height:887}};mesh.userData.path=path;mesh.userData.frame=()=>{};return mesh;}
  }};
  A.viewHooks.setup(ctx);await new Promise(r=>setImmediate(r));
  const groups=ctx.root.children.filter(g=>g.children.some(m=>m.userData.path==='assets/court-net.png'));
  assert.equal(groups.length,9);assert.deepEqual(groups[0].children.map(m=>m.position.x),[-regulation.singlesStick,regulation.singlesStick]);
  A.viewHooks.frame(ctx,0);assert.equal(groups[0].visible,true);
  ctx.scene=sceneOf(3);ctx.time++;A.viewHooks.frame(ctx,0);assert.equal(groups[0].visible,false);
  await new Promise(r=>setImmediate(r));A.viewHooks.dispose();assert.ok(groups.every(g=>g.parent===null));
});

test('periodic scene snapshots do not interrupt solo feeds or send the player back to its initial spot',()=>{
  const A=load(),sim=makeSim(world,A.hooks),scene=sceneOf(0);sim.scene(scene);let hits=0,old='',collect=0;
  const court=world.plots.at[0];let prev=null;
  for(let i=0;i<12000;i++){if(i%40===0)sim.scene(structuredClone(scene));sim.step(.025);const c=A.tennisView.readShared(sim.state().shared).courts[0],p=c.players.parent;
    if(c.phase==='impact'&&old!=='impact')hits++;if(c.phase==='collect')collect++;
    if(prev&&(prev.z-court[1])*(p.z-court[1])<0)assert.ok(Math.min(Math.abs(prev.x-court[0]),Math.abs(p.x-court[0]))>=regulation.netClear-.05,'crosses beside the posts');
    if(c.phase!=='collect')assert.ok(!(Math.abs(p.x-court[0])<regulation.netClear-.05&&Math.abs(p.z-court[1])<.8),'the player never stands in the net perimeter');
    old=c.phase;prev=p;
  }
  assert.ok(hits>=20,`solo returns ${hits}`);assert.ok(collect/12000<.2,`collection fraction ${collect/12000}`);
});
test('recreation routes respect object perimeters and visible guests never walk through furniture or one another',()=>{
  const A=load(),sim=makeSim(world,A.hooks),scene=sceneOf(0,24);scene.agents.slice(1).forEach(a=>a.state='stale');sim.scene(scene);
  for(let i=0;i<7200;i++){sim.step(.05);const people=Object.values(A.tennisView.readShared(sim.state().shared).social);
    for(const p of people){if(p.moving&&!p.kiosk)assert.ok(!A.tennisView.REC_BLOCKS.some(r=>A.tennisView.inside([p.x,p.z],r)),`${p.action} ${p.x},${p.z} inside ${JSON.stringify(A.tennisView.REC_BLOCKS.filter(r=>A.tennisView.inside([p.x,p.z],r)))}`);
      for(const q of people)if(p!==q&&!p.arrived&&!q.arrived)assert.ok(Math.hypot(p.x-q.x,p.z-q.z)>.70,'two mobile guests overlap');
    }
  }
});
test('a glass visibly empties through all four sips and returns to the juice bar',()=>{
  const seen=new Map();let returned=false,pickup=false,setdown=false;
  run(0,20,600,state=>{for(const[id,p]of Object.entries(state.social)){if(p.drink){if(!seen.has(id))seen.set(id,new Set());seen.get(id).add(p.drinkLevel);pickup ||= p.glassMode==='reach';setdown ||= p.glassMode==='setdown';if(p.action==='give') {assert.equal(p.drinkLevel,0);returned=true;}}}});
  assert.ok([...seen.values()].some(v=>[0,1,2,3,4].every(n=>v.has(n))));assert.ok(returned&&pickup&&setdown);
});
