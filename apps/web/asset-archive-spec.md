---
schema_id: asset-archive-contract
schema_version: 1
document_type: normative-machine-readable-markdown
container_media_types:
  - application/zip
accepted_extensions:
  - .ipa
  - .zip
runtime_validated_capabilities:
  - battle
  - world_navigation
  - town_retained_map
  - monster_management
  - monsterpedia
local_runtime_integrated_capabilities:
  - collection_local_route
last_updated: 2026-08-23
---

# Asset Archive Contract v1

This document defines the package boundary consumed by the moddable, swappable-asset game engine.
The terms **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**, and **MAY** are normative.

## 1. Processing model

- An Asset Archive MUST be a ZIP-compatible byte stream.
- An archive MUST initially enter through explicit user selection with the browser File API.
- After validation and rights attestation, the engine MAY restore the exact selected compressed
  bytes from a client-only last-used cache. A different raw SHA-256 MUST require new attestation.
- The engine MUST process the archive in the current browser tab.
- The engine MUST NOT require an executable, code signature, provisioning profile, bundle ID,
  vendor identifier, upload endpoint, remote loader, or persistent archive storage.
- A last-used archive cache MUST be disposable, MUST NOT contain expanded resources or durable game
  state, and MUST be removed before application-controlled cleanup removes an Offline save.
- Resource URLs MUST be session-scoped `blob:` URLs and MUST be revoked when the imported package
  is disposed.
- Package metadata MUST NOT select a package-specific loader or relax schema validation.
- Browser-local save identity MUST use scope `dib-identity-plists-v7`. Every present root
  `Collection.plist` MUST enter the v7 canonical projection; it remains optional at the
  fingerprint layer. The exact v6 projection MUST exclude only that file before deriving the
  unchanged v5-v1 lineage. Historical v1-v6 state MUST migrate only when player runtime schema 1
  implies no Collection claims or schema 2 has an empty `claimedCollectionGoalIds`; claimed
  historical records MUST remain occupied, incompatible, and preserved. This local identity MUST
  remain separate from Official `logic-v1`.

## 2. Archive envelope

Exactly one of the following resource-root shapes MUST be present.

### 2.1 App envelope

```text
Payload/<arbitrary-name>.app/Monsters.plist
Payload/<arbitrary-name>.app/Jobs.plist
Payload/<arbitrary-name>.app/Abilities.plist
```

### 2.2 Flat envelope

```text
Monsters.plist
Jobs.plist
Abilities.plist
```

The directory containing all three discovery files is the resource root. Exactly one candidate
resource root MUST exist.

### 2.3 ZIP safety constraints

| Constraint | Required value |
| --- | ---: |
| Maximum compressed archive size | 268,435,456 bytes |
| Maximum expanded size | 536,870,912 bytes |
| Maximum entry count | 5,000 |
| Maximum uncompressed entry size | 67,108,864 bytes |
| Allowed compression methods | 0 (stored), 8 (deflate) |
| Path separator | `/` |

Entry paths MUST be relative and canonical. An entry MUST be rejected if its path contains a NUL,
a backslash, an absolute prefix, a drive prefix, or a `..` component.

## 3. Retained resource forms

Only the following resource-root-relative extensions are retained:

```yaml
retained_extensions:
  property_lists: [.plist, .strings]
  raster_images: [.png]
  bitmap_fonts: [.fnt]
  audio: [.m4a, .mp3, .wav]
  structured_text: [.json, .csv]
  text: [.txt]
```

All other entries MAY be ignored. Retained paths are case-sensitive.

## 4. Required runtime resources

```yaml
required:
  - Monsters.plist
  - Combines.plist
  - Jobs.plist
  - Abilities.plist
  - AbilityComponents.plist
  - Info.plist
  - Credits.plist
  - mainscreenBackground.png
  - saveSlotBackground.png
  - ClerkGirl-hd.png
  - TutorialRightSide-hd.png
  - Opening1.mp3
  - click.m4a
  - Scale9Sprites.plist roles [MenuButton2, PopupBackgroundThin]
  - one_of:
      - en.lproj/Localizable.strings
      - Localizable.strings
conditional:
  Buffs.plist: required when referenced by an ability
  Items.plist: required when item or elemental-stone mechanics are reachable
  Licenses.plist: required when Character/Gem or Arena progression is reachable
  ShopScreen.png + buy.png: StoreNode background/purchase control when Store is reachable
  Animations.plist: required by authored renderer choreography
  MeleeAttacks.plist: required when an ability declares an attack type
  Scale9Sprites.plist: required by scalable UI roles
  world_navigation:
    required:
      - Worlds.plist
      - PointsOfInterest.plist
      - HeroWalkFrames-hd.plist
      - HeroWalkFrames-hd.png
      - greenFlag-hd.png
      - redFlag-hd.png
      - blueFlag-hd.png
      - menuButton-hd.png
      - namePlate-hd.png
      - General-hd.plist frames [heroXpFrame.png, heroXpBar.png]
      - walkArrow.png
      - ipadBorder.png
      - Field1.mp3
  town_retained_map:
    required_when_any_world_contains_a_town:
      - nonempty buildings and exit in the town POI
      - every data-referenced house/icon/exit/questGiver PNG
      - night.m4a
      - rooster.m4a
      - Town1.mp3
      - sunrise-hd.png
      - removeAllFromBattingOrder-hd.png
      - localization keys [DayFormatKey, DayEndKey, BattleGroupKey, SortButtonKey]
      - localization pairs [BattingOrderFull, CannotRemoveAllFromBattingOrder, ConfirmRemoveAllFromBattingOrder]
  source_intro_when_complete:
    optional_activation_set:
      - Plot.plist
      - plot_start1.png
      - pickDragonBacking-hd.png
      - BlueBabyDragon-hd.png
      - RedBabyDragon-hd.png
      - WhiteBabyDragon-hd.png
      - GoldBabyDragon-hd.png
      - fieldMovement.png
      - battleTutorial1.png
      - battleTutorial2.png
      - catchTutorial.png
      - Dungeon2.mp3
  guild_quests_when_present:
    required:
      - ordered strict Quests.plist
      - backpack-hd.png
      - quest-hd.png
      - questComplete-hd.png
    tavern_requires:
      - Menus.plist Tavern.fullScreenBackground root PNG
      - TavernMenuItem questGiver PNG
      - notification-hd.png
  monsterpedia:
    required:
      - bookPage.png
      - leaveIcon.png
      - cancelMonsterPickButton-hd.png
      - orderLeftArrow-hd.png
      - orderRightArrow-hd.png
      - MonsterpediaFrames-hd.plist
      - MonsterpediaFrames-hd.png
```

If both localization paths exist, `en.lproj/Localizable.strings` takes precedence.
`Info.plist` MUST contain a nonempty `CFBundleShortVersionString` or `CFBundleVersion`.
`Credits.plist` MUST be a nonempty array of title/entry string rows and positive numeric space
rows. Startup backgrounds MUST be at least 1024×768. Both startup scale-9 roles MUST resolve their
configured `-hd` PNGs.
Town resources validate and render the retained-map arrival/departure shell. Monsters,
Monsterpedia, and a fully-resolved Tavern/Guild destination are implemented; other visible
building controls remain inert until their individual destination systems are implemented.
The source intro is an optional all-or-nothing runtime capability: when the complete activation
set above and the four named monster definitions are present, a fresh slot runs the plot/starter
flow and its first field/battle tutorials. The full-screen plot PNGs use the authored 1024x768
rectangle at the top of a POT image. An optional town-building `tutorialFlashKey` is retained and
drives the source additive button hint when its flag is unseen.
Tavern `chats`, `inProgressQuests`, and `quests` conditions are evaluated against durable Guild
state, including leading-`!` negation. Other condition families are not implied.

## 5. Property-list rules

- XML plist and `bplist00` encodings are accepted.
- Runtime objects are strict. Unknown keys MUST cause validation failure unless this document marks
  the value as opaque.
- Parent references are dotted paths within the same plist dictionary.
- Parent chains MUST be acyclic and all parents MUST resolve.
- Dictionaries deep-merge from parent to child, except that a child-authored
  `jobAbilities.<slot>` value replaces the inherited slot value wholesale.
- Human-facing names and descriptions SHOULD be localization entries, not extra keys on strict
  runtime nodes.

## 6. Monster schema

A resolved monster leaf MUST match:

```yaml
class: Monster
category: one of [Collection, Combine, Egg, Normal, Summon]
element: one of [Air, Arcane, Death, Earth, Fire, Life, Water]
index: number
quality: number
stars: number
unarmedAttackType: string
rootStats:
  Attack: number
  Defense: number
  Magic: number
  MaxHP: number
  Resist: number
  Speed: number
evolveData:                         # optional
  levelReq: number
  newType: string
eggUnlockQuality: number            # optional in the archive; defaults to `quality` once loaded
summonXpBonus: number               # optional
rendererData: any                   # optional opaque renderer value
```

An omitted `eggUnlockQuality` is materialized as that leaf's `quality` when the archive is loaded,
matching the native `Monster` initializer; consumers never observe the field as absent.

`index` MUST be unique across resolved monster leaves. `evolveData.newType` MUST resolve to a known
monster identity.

### 6.1 Cinder Harbor example

```yaml
Fire.Emberling:
  parent: RootMonster
  unarmedAttackType: Impact
  element: Fire
  stars: 1.75
  quality: 1
  rootStats: {Attack: 3, Resist: 2, Defense: 2, Speed: 2, Magic: 2, MaxHP: 10}
  index: 100
  evolveData: {levelReq: 5, newType: Pyrecrest}
```

## 7. Job schema

A resolved job leaf MUST match:

```yaml
class: Job
slots: [string, ...]
xpPenalty: number
jobAbilities:
  <slot-name>:
    type: dotted ability path
    arguments: dictionary           # optional opaque construction arguments
```

Every playable monster MUST have a matching resolved job and at least one executable `usableN`
slot. Slot names are unioned through inheritance. A child slot replacement MUST repeat every value
required by that slot; nested slot values do not deep-merge.

### 7.1 Cinder Harbor example

```yaml
Fire.Emberling:
  parent: RootJob
  jobAbilities:
    usable1:
      type: Moves.SparkPeck
      arguments: {instanceName: SparkPeck}
```

## 8. Ability schema

A battle-usable resolved ability MUST use `class: CombatAbility`, contain a supported
`targetPicker`, and reference only implemented components.

```yaml
class: string
activationLength: string            # optional
components:                         # optional
  - type: dotted component path
    arguments: dictionary           # optional
targetPicker: dictionary            # optional; required for battle-usable abilities
aiChance: number                    # optional
eventData: any                      # optional opaque presentation value
soundTable: {string: string}        # optional
abilityScalor: number               # optional
abstract: boolean                   # optional
noHaste: boolean                    # optional
enemyBuffs: [any, ...]              # optional
sourceBuffs: [any, ...]             # optional
friendlyBuffs: [any, ...]           # optional
passiveBuffs: [any, ...]            # optional
revengeBuffs: [any, ...]            # optional
```

Supported target-picker fields are:

```yaml
class: TargetPickerGui
selfOnly: boolean                    # automatic self target
allEnemies: boolean                  # automatic all-enemy target
allFriends: boolean                  # automatic all-friendly target
enemyTargets: non-negative integer  # manual enemy count
friendlyTargets: non-negative integer # manual friendly count
```

The fields MAY be combined only when the resulting target phases are meaningful. Every final target
count MUST be satisfiable by the authored battle context.

### 8.1 Cinder Harbor example

```yaml
Moves.SparkPeck:
  class: CombatAbility
  activationLength: "{3}"
  components:
    - type: Offensive.MagicAttack
  targetPicker:
    class: TargetPickerGui
    enemyTargets: 1
```

## 9. Ability-component schema

Resolved component definitions MUST match:

```yaml
class: string
roll:                             # optional
  relatedStat: string
```

`class` MUST be implemented by the current engine. Implemented component class names are:

```yaml
implemented_component_classes:
  - AddMonsterAbilityComponent
  - AnalyzeAbilityComponent
  - ApplyBuffAbilityComponent
  - AttackAbilityComponent
  - CallMonsterAbilityComponent
  - CaptureAbilityComponent
  - ConfuseAbilityComponent
  - DamageDealingAbilityComponent
  - DesoulAbilityComponent
  - DiceAbilityComponent
  - DrainLifeAbilityComponent
  - EscapeAbilityComponent
  - HasteAbilityComponent
  - HealingAbilityComponent
  - MagnifyAbilityComponent
  - MoveToFrontAbilityComponent
  - ParalyzeAbilityComponent
  - RemoveAllBuffsAbilityComponent
  - SacrificeAbilityComponent
  - SleepAbilityComponent
  - SpendSilverAbilityComponent
  - StatModAbilityComponent
  - StatusRemoveAbilityComponent
  - StunAbilityComponent
  - SwitchAbilityComponent
```

The defining component, ability reference, and job reference jointly provide construction
arguments. A component is compatible only when all required arguments are present. Authors MUST
run every assigned move through the package validator; parsing alone does not prove constructibility.

## 10. Buff and item schemas

Resolved buff definitions MUST match:

```yaml
class: string
statusEffects: {string: boolean}   # optional
fixedReflect: boolean              # optional
eventData: any                     # optional opaque presentation value
```

When elemental stones are reachable, `Items.plist` MUST define all seven paths:

```yaml
required_stones:
  - SoulStones.AirSoulStone
  - SoulStones.ArcaneSoulStone
  - SoulStones.DeathSoulStone
  - SoulStones.EarthSoulStone
  - SoulStones.FireSoulStone
  - SoulStones.LifeSoulStone
  - SoulStones.WaterSoulStone
stone_schema:
  class: SoulStone
  slot: Monster
  stats: partial map of [Attack, Defense, Magic, MaxHP, Resist, Speed] to boolean
```

## 11. Renderer asset roles

Expressive content MAY vary. Structural role keys MUST remain available until the renderer gains a
separate role manifest.

### 11.1 Monster roles

For each playable monster short type `<T>`:

- `<T>-hd.png` MUST exist as a standalone sprite.
- `<T>_icon.png` MUST exist as a frame owned by `MonsterPortraits-hd.plist`.

### 11.2 Required atlases

```yaml
required_atlas_keys:
  - General-hd
  - MonsterPortraits-hd
  - MonsterpediaFrames-hd
  - InventoryItemFrames-hd
  - FXSheet-hd
```

Each atlas plist MUST use Cocos format-2 geometry and MUST resolve a PNG sheet through either
`<atlas-stem>.png` or its metadata filename. Rotated frame dimensions MUST remain unswapped.

### 11.3 Required standalone sprites

```yaml
required_sprite_keys:
  - MMScreen
  - PopupMenuCloseButton-hd
  - inBattingOrderBkg-hd
  - notInBattingOrderBkg-hd
  - emptySlotHeads-hd
  - emptySlotArrows-hd
  - orderAllLeftArrow-hd
  - orderLeftArrow-hd
  - orderRightArrow-hd
  - orderAllRightArrow-hd
  - soulStoneButton-hd
  - sortByName-hd
  - sortByStars-hd
  - sortByLevel-hd
  - destroyMonster-hd
  - sleepZ-hd
  - confusionStatus-hd
  - paralyzeBolt-hd
  - downArrow-hd
  - combatBottomBar-hd
  - heroBattlePortrait-hd
  - heroFrame-hd
  - button-hd
  - benchButton-hd
  - retreatButton-hd
  - delayButton-hd
  - benchBox-hd
  - spiritBkg-hd
  - charscreenBackButton-hd
  - captureCard1-hd
  - captureCard2-hd
  - captureCard3-hd
  - cardGlow-hd
  - largeRarityStar-hd
  - monsterEvolved
  - scrollbar-hd
  - scrollbarTrack-hd
```

The runtime additionally requires the structural frame names validated by the Cinder Harbor source
kit's `scripts/current_runtime.py`. That validator is the executable frame-role list for contract
version 1.

### 11.4 Combat backgrounds

At least one bare `<Biome>Combat.png` MUST exist and MUST be at least 1024×768 pixels. A filename
ending in `-hd` does not satisfy this discovery role.

### 11.5 Bitmap fonts

```yaml
required_font_keys:
  - arial_14-hd
  - arial_14_bold-hd
  - arial_18_bold-hd
  - arial_20_bold-hd
```

Each `.fnt` MUST contain exactly one well-formed `info` line with one quoted `face` attribute and a
page filename that resolves inside the resource root. The authored font face is not prescribed;
the listed keys are technical roles.

### 11.6 Particles

Each particle plist MUST define `textureFileName`, and that texture MUST resolve. The current
reachable battle/world-management surface requires `PoisonParticles.plist`,
`progressBarParticles.plist`, and `destroyMonsterParticles.plist`. `Heal.plist` is a shipped
asset and MUST stay extracted, but it is an ARCHIVAL role, not a runtime load: its only
shipped constructor (`ParameterEffectBuilder`'s healing branch) leaves the system manual and
unregistered, so it never emits. Ability-authored
`ParticleEffectBuilder` files (including global builders) are data-referenced roles. A promoted dungeon surface also
requires `Sparkle.plist`; RoomNode mounts its continuous point-particle system on every chest.

### 11.7 Audio

Audio keys are filename stems. When equal stems exist in more than one supported encoding,
deterministic precedence is M4A, then MP3, then WAV, with the later format replacing the earlier.

```yaml
required_audio_stems:
  - Encounter
  - click
  - notAllowed
  - CaptureSuccess
  - CaptureFail
  - Escape
  - Battle1
  - Battle2
  - Battle3
  - Battle4
  - Battle5
  - Battle6
  - Battle7
  - Win1
  - Evolve1
```

Every ability sound selected by authored data MUST also resolve.

## 12. Localization

- `.strings` files MUST be plist-compatible dictionaries.
- Every value MUST be a string.
- Every renderable monster, ability, popup, status, UI, world, town, quest, and dialogue key
  referenced by retained data MUST resolve.
- Structural UI localization keys are runtime API roles for contract version 1.
- Loading, title, save selection, erase confirmation, credits/options, volume, and confirmation
  localization keys checked by `validateStartupResources()` MUST resolve.

## 13. Current Tournament extension and retained future resource families

When present, `Tournaments.plist` MUST be an ordered array of uniquely named strict entries. Each
entry MUST contain only a nonempty `name`, `subtitle`, positive integer `challengeLevel`, nonempty
`prizeImage`, exactly four `monsterPopulators`, and `treasureData`. Current round populators MUST
resolve to one nonempty fixed encounter. Packages exposing Tournament play MUST also provide
`tournamentBrackets-hd.png`, `ArenaCombat.png`, referenced renderables, and the required localized
Tournament/status/action strings. Local play and Official-online Tournament both consume the four-round
progression and shared reward path. Official-online Tournament uses server-owned prize settlement with the
`tournament.claimPrize` / `tournament.settlePrize` continuation for Egg rewards.

A present root `Collection.plist` is identity-bearing for offline scope v7 and is parsed strictly.
When a world promotes `MonsterCollectionMenuItem`, the archive MUST provide the exact catalog
root. Every promoted root MUST provide the base title `CollectionHutListTitleKey` and intro/chat
`MonsterCollectionChatKey` localization, `PopupMenuCloseButton-hd.png`, the `arial_18_bold-hd`
font/page, and the exact `downArrow-hd.png` finish sprite. The shared `guildQuestChat` helper
retains a bare `downArrow` fallback because generic quest/arena/chat routes are not globally
validated as Collection routes. If the root contains reachable authored goals, it MUST also
provide the row title/description (`<key>CollectionQuestTitleKey`/`<key>CollectionQuestDescriptionKey`),
`CollectionGoalKey`, `OkButtonKey`, and `AlreadyFinished*` repeat localization. If a reachable
authored goal contains a supported reward spawn, it MUST provide `NewItemsKey`/`TakeAllKey`, the
consumed reward title/arrow/atlas/frame roles; an authored spawn with effective chance zero is not
reachable for this closure. A package without
such a route MAY omit the catalog and Collection-only roles; a present unpromoted catalog is still
strictly parsed. The route is integrated in local and Official play, unit/component tested, and
browser-proven in both modes. Official v12+ accepts only semantic `collection.claim`; the current
v14 authority routes fixed `egg`/`monsterEgg` rewards through its owned hatch continuation.
Supported rewards MUST preserve claim-before-generation.

The following resources MAY be retained for future engine modules:

```yaml
future_families:
  narrative: [Dialogs.plist, Chats.plist, Plot.plist]
  dungeons: [Dungeons.plist, "Dungeon_<id>.plist", Rooms.plist, ZoneChanges.plist]
  display_only: [ThingsInWorld.plist]
```

When present, `Quests.plist` is a strict current extension: its ordered objective catalog,
durable runtime, Tavern and MasterMenu list/Chat routes, and reward recipes are consumed. That
does not make every story encounter, event producer, condition family, or license gate complete.

Retention or reference closure MUST NOT be described as runtime validation. A future capability MAY
be marked runtime-validated only after it has a typed loader, strict schemas, engine behavior tests,
and browser proof.

## 14. Supplementary Offline Mods

Offline play MAY select one or more supplementary `.dibmod` ZIPs. A v4 mod MUST contain a strict
`manifest.json`, its declared JavaScript entry, and MAY contain arbitrary mod-owned supporting
files. It MUST declare API and schema version 4, `mode: "offline"`, and dependency version ranges. It MUST
NOT declare a permissions list: selection grants the entire page runtime. The picker MUST warn that
mods can read/change saves and storage, use the network, load code, and replace any client behavior.

Resolution MUST be deterministic over declared hard, optional, and soft load-order relations, with
priority and ID as tie-breaks; selection order MUST NOT affect it. A declared conflict MUST refuse
the profile unless explicitly overridden. Remaining overlaps between packages MUST be reported to
the player and MUST NOT block activation.

An implementation MAY cache recently-used mod archives on the device to restore a remembered
archive+mod pairing. Such a cache MUST NOT activate code on its own: restoring a pairing MUST leave
the player an explicit launch step. When the last launched Offline pairing remains fully cached,
the implementation MUST restore that exact ordered selection on reload unless the player has
explicitly cleared mods and suppressed profile restoration. The profile UI MUST show a
compact compressed byte-size metric for each entry when its current or last-known size is available.
The cache MUST be evicted least-recently-used under a bounded ceiling and MUST yield to Offline save
storage under storage pressure. Cached bytes and pairing records MUST
remain browser-local and MUST NOT be admitted by Official play. Official play MUST reject selected mods.
Once full-trust mod code has executed, Official play MUST remain unavailable for that document even
if the mod picker is cleared; a new document is required to establish a clean client. Offline save
identity MUST bind effective mechanics-bearing runtime data after content overlays, rather than
incidental mod package bytes or activation order. A changed exact profile MUST warn before opening
an existing save namespace, even when the data identity is unchanged. An explicit cross-profile
"Try here" override MUST clone into a free destination slot and retain the original. Clearing mods
after execution MUST reload the document to permit Official play again. Production MUST execute v4 code in
the application realm without a worker, iframe, value membrane, quota, or feature allowlist.

The host MUST expose generic lifecycle replacement, a shared service registry, arbitrary bundle
file access, property/method interception, and a generated lazy catalog of all web runtime modules.
The current lifecycle and JavaScript author contract are defined in `docs/code-mod-api.md`.

## 15. Reading and modifying packages

1. A reader MUST validate ZIP paths and limits before expansion.
2. A reader MUST discover exactly one resource root from the three discovery plists.
3. A reader SHOULD expose paths relative to that resource root.
4. A modifier SHOULD work from an editable source tree with a deterministic builder.
5. A modifier MUST preserve plist scalar types, exact identifier case, reference closure, atlas
   ownership, font-page links, and audio stems.
6. A modifier SHOULD update localization, provenance, licenses, validation reports, and generated
   manifests in the same change as affected content.
7. A release build MUST use fixed ZIP timestamps, ordering, permissions, compression settings, and
   stable digest-derived random seeds.

## 16. Validation contract

A release candidate MUST pass:

```yaml
validation_gates:
  envelope:
    - safe paths
    - exactly one resource root
    - supported compression
    - all size and count limits
  schema:
    - strict monster, job, ability, component, buff, and stone schemas
    - valid acyclic inheritance
    - unique monster indices
  closure:
    - all data references
    - all atlas frames and sheets
    - all font pages
    - all particle textures
    - all audio stems
    - all localization keys
  runtime:
    - every assigned ability constructs
    - a bounded deterministic battle terminates
  presentation:
    - fixed viewport scene construction
    - no console or page errors
    - visual evidence reviewed by a person
  reproducibility:
    - two clean builds produce identical archive SHA-256
    - two clean builds produce identical source-kit SHA-256
  distribution:
    - compiled game assets are not embedded in the engine build
```

The Cinder Harbor source kit is the base implementation of these gates. Compatibility testing does
not establish copyright, trademark, provenance, or license rights; those require independent review.
