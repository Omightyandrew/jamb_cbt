-- Seed the 12 subjects not covered by the existing English syllabus rows.
-- Source: JAMB IBASS (https://ibass.jamb.gov.ng/), accessed 2026-09-16.
-- IBASS syllabus content is dynamically served and was not machine-readable during
-- preparation. Official domain names are retained where known; other section names
-- are explicitly marked as ExamPilot navigation groupings.
-- This migration is additive: it never updates or deletes existing syllabus rows.

CREATE TEMP TABLE _exam_pilot_syllabus_seed (
  name text PRIMARY KEY,
  display_name text NOT NULL,
  subtitle text NOT NULL,
  icon text NOT NULL,
  overview text NOT NULL,
  display_order integer NOT NULL,
  sections jsonb NOT NULL
) ON COMMIT DROP;

INSERT INTO _exam_pilot_syllabus_seed (name, display_name, subtitle, icon, overview, display_order, sections)
VALUES
('Mathematics', 'Mathematics', 'UTME Mathematics', 'M', 'Revise number, algebra, geometry, statistics, calculus and applied mathematics.', 2, $$[
  {"title":"Number and Numeration","description":"ExamPilot navigation grouping for JAMB Mathematics topics.","topics":["Number bases","Fractions, decimals and percentages","Indices, logarithms and surds","Ratio, proportion and variation","Sets and operations","Approximation and errors","Sequences and series"]},
  {"title":"Algebra","description":"ExamPilot navigation grouping for JAMB Mathematics topics.","topics":["Algebraic expressions","Linear equations and inequalities","Quadratic equations","Simultaneous equations","Variation","Functions","Matrices and determinants"]},
  {"title":"Geometry and Trigonometry","description":"ExamPilot navigation grouping for JAMB Mathematics topics.","topics":["Angles and triangles","Polygons and circles","Mensuration","Coordinate geometry","Trigonometric ratios","Trigonometric identities","Bearings and distances"]},
  {"title":"Calculus","description":"ExamPilot navigation grouping for JAMB Mathematics topics.","topics":["Limits and continuity","Differentiation","Applications of differentiation","Integration","Applications of integration"]},
  {"title":"Statistics and Probability","description":"ExamPilot navigation grouping for JAMB Mathematics topics.","topics":["Data collection and presentation","Mean, median and mode","Measures of dispersion","Probability","Frequency distributions"]}
]$$::jsonb),
('Physics', 'Physics', 'UTME Physics', 'P', 'Study measurement, mechanics, heat, waves, electricity, fields and modern physics.', 3, $$[
  {"title":"Measurement and Units","description":"ExamPilot navigation grouping for JAMB Physics topics.","topics":["Physical quantities and units","Measurement instruments","Dimensions","Scalars and vectors"]},
  {"title":"Mechanics","description":"ExamPilot navigation grouping for JAMB Physics topics.","topics":["Motion","Forces and equilibrium","Work, energy and power","Momentum and collisions","Gravitation","Simple machines","Fluids and pressure"]},
  {"title":"Heat and Thermal Physics","description":"ExamPilot navigation grouping for JAMB Physics topics.","topics":["Temperature and thermometry","Thermal expansion","Heat transfer","Change of state","Gas laws","Kinetic theory"]},
  {"title":"Waves and Optics","description":"ExamPilot navigation grouping for JAMB Physics topics.","topics":["Wave motion","Sound","Reflection","Refraction","Lenses","Diffraction and interference","Electromagnetic waves"]},
  {"title":"Electricity and Magnetism","description":"ExamPilot navigation grouping for JAMB Physics topics.","topics":["Electrostatics","Current electricity","Electrical circuits","Magnetic fields","Electromagnetic induction","Alternating current","Electrical energy and power"]},
  {"title":"Modern Physics","description":"ExamPilot navigation grouping for JAMB Physics topics.","topics":["Atomic structure","Photoelectric effect","Radioactivity","Nuclear energy","Semiconductors"]}
]$$::jsonb),
('Chemistry', 'Chemistry', 'UTME Chemistry', 'C', 'Revise atomic structure, bonding, calculations, inorganic, organic and environmental chemistry.', 4, $$[
  {"title":"Separation Techniques and Matter","description":"ExamPilot navigation grouping for JAMB Chemistry topics.","topics":["Particles of matter","States of matter","Separation and purification techniques","Kinetic theory","Solutions"]},
  {"title":"Atomic Structure and Periodicity","description":"ExamPilot navigation grouping for JAMB Chemistry topics.","topics":["Atomic structure","Electronic configuration","Isotopes","Periodic table","Periodic properties"]},
  {"title":"Chemical Bonding and Reactions","description":"ExamPilot navigation grouping for JAMB Chemistry topics.","topics":["Chemical bonding","Shapes of molecules","Chemical equations","Types of chemical reactions","Oxidation and reduction","Rates of reaction","Chemical equilibrium"]},
  {"title":"Stoichiometry and Energetics","description":"ExamPilot navigation grouping for JAMB Chemistry topics.","topics":["Mole concept","Empirical and molecular formulae","Gas laws","Energy changes in reactions","Electrolysis"]},
  {"title":"Acids, Bases and Salts","description":"ExamPilot navigation grouping for JAMB Chemistry topics.","topics":["Properties of acids and bases","pH and indicators","Neutralisation","Solubility","Salt preparation"]},
  {"title":"Inorganic Chemistry","description":"ExamPilot navigation grouping for JAMB Chemistry topics.","topics":["Water","Air and atmospheric chemistry","Metals and their compounds","Non-metals and their compounds","Qualitative analysis"]},
  {"title":"Organic Chemistry","description":"ExamPilot navigation grouping for JAMB Chemistry topics.","topics":["Hydrocarbons","Functional groups","Isomerism","Alcohols and acids","Polymers","Petroleum chemistry"]}
]$$::jsonb),
('Biology', 'Biology', 'UTME Biology', 'B', 'Cover cell biology, life processes, genetics, evolution, ecology and biological systems.', 5, $$[
  {"title":"Organisation of Life","description":"ExamPilot navigation grouping for JAMB Biology topics.","topics":["Characteristics of living organisms","Cell structure and functions","Cell organisation","Tissues and organs","Cell division"]},
  {"title":"Nutrition and Life Processes","description":"ExamPilot navigation grouping for JAMB Biology topics.","topics":["Modes of nutrition","Photosynthesis","Respiration","Digestion","Excretion","Support and movement"]},
  {"title":"Transport and Coordination","description":"ExamPilot navigation grouping for JAMB Biology topics.","topics":["Transport in plants","Transport in animals","Nervous coordination","Hormonal coordination","Homeostasis"]},
  {"title":"Reproduction and Genetics","description":"ExamPilot navigation grouping for JAMB Biology topics.","topics":["Asexual reproduction","Sexual reproduction","Human reproduction","Inheritance","Variation and mutation"]},
  {"title":"Evolution and Ecology","description":"ExamPilot navigation grouping for JAMB Biology topics.","topics":["Evidence of evolution","Natural selection","Population studies","Food chains and webs","Ecological factors","Conservation"]},
  {"title":"Organisms and Health","description":"ExamPilot navigation grouping for JAMB Biology topics.","topics":["Classification of organisms","Adaptation","Microorganisms","Disease and immunity","Pollution and public health"]}
]$$::jsonb),
('Government', 'Government', 'UTME Government', 'G', 'Understand political concepts, institutions, constitutional development, elections and international relations.', 6, $$[
  {"title":"Political Concepts","description":"ExamPilot navigation grouping for JAMB Government topics.","topics":["State, nation and sovereignty","Power, authority and legitimacy","Democracy and rule of law","Political culture and socialisation","Citizenship and national integration"]},
  {"title":"Forms and Systems of Government","description":"ExamPilot navigation grouping for JAMB Government topics.","topics":["Unitary and federal systems","Presidential and parliamentary systems","Monarchy and republican government","Confederation","Military rule"]},
  {"title":"Constitutional Development","description":"ExamPilot navigation grouping for JAMB Government topics.","topics":["Constitutions and constitutionalism","Pre-independence constitutional development","Post-independence constitutions","Federalism and separation of powers","Fundamental human rights"]},
  {"title":"Political Parties and Elections","description":"ExamPilot navigation grouping for JAMB Government topics.","topics":["Political parties","Party systems","Electoral systems","Electoral commissions","Voting and representation"]},
  {"title":"Public Administration","description":"ExamPilot navigation grouping for JAMB Government topics.","topics":["Public service","Civil service","Local government","Public corporations","Pressure groups and public opinion"]},
  {"title":"Foreign Policy and International Relations","description":"ExamPilot navigation grouping for JAMB Government topics.","topics":["Nigeria foreign policy","Diplomatic relations","International organisations","ECOWAS","African Union","United Nations"]}
]$$::jsonb),
('Literature', 'Literature in English', 'UTME Literature in English', 'L', 'Develop skills in prose, poetry, drama, literary devices, themes and appreciation.', 7, $$[
  {"title":"Literary Concepts","description":"ExamPilot navigation grouping for JAMB Literature in English topics.","topics":["Genre","Plot","Setting","Characterisation","Theme","Point of view","Style and tone"]},
  {"title":"Poetry","description":"ExamPilot navigation grouping for JAMB Literature in English topics.","topics":["Poetic forms","Figures of speech","Sound devices","Tone and mood","Imagery and symbolism","Persona and diction"]},
  {"title":"Prose","description":"ExamPilot navigation grouping for JAMB Literature in English topics.","topics":["Narrative techniques","Character and conflict","Theme and setting","Point of view","Style","Structure and symbolism"]},
  {"title":"Drama","description":"ExamPilot navigation grouping for JAMB Literature in English topics.","topics":["Dramatic structure","Dialogue and stagecraft","Characterisation","Conflict","Tragedy and comedy","Irony and suspense"]},
  {"title":"African and Non-African Literature","description":"ExamPilot navigation grouping for JAMB Literature in English topics.","topics":["African prose","African poetry","African drama","Non-African prose","Non-African poetry","Non-African drama"]}
]$$::jsonb),
('Economics', 'Economics', 'UTME Economics', 'E', 'Study economic principles, markets, production, national income, public finance and development.', 8, $$[
  {"title":"Basic Economic Concepts","description":"ExamPilot navigation grouping for JAMB Economics topics.","topics":["Scarcity and choice","Opportunity cost","Production possibility curve","Factors of production","Economic systems","Basic economic problems"]},
  {"title":"Demand and Supply","description":"ExamPilot navigation grouping for JAMB Economics topics.","topics":["Law of demand","Law of supply","Elasticity","Market equilibrium","Price determination"]},
  {"title":"Production and Cost","description":"ExamPilot navigation grouping for JAMB Economics topics.","topics":["Division of labour","Scale of production","Fixed and variable costs","Revenue","Productivity"]},
  {"title":"Market Structures","description":"ExamPilot navigation grouping for JAMB Economics topics.","topics":["Perfect competition","Monopoly","Monopolistic competition","Oligopoly"]},
  {"title":"National Income","description":"ExamPilot navigation grouping for JAMB Economics topics.","topics":["GDP and GNP","Income measurement","Circular flow","Per capita income","National income problems"]},
  {"title":"Money and Banking","description":"ExamPilot navigation grouping for JAMB Economics topics.","topics":["Functions of money","Commercial banks","Central bank","Credit creation","Monetary policy"]},
  {"title":"Public Finance and Development","description":"ExamPilot navigation grouping for JAMB Economics topics.","topics":["Government revenue","Taxation","Public expenditure","Budget","Inflation","Unemployment","Economic growth and development"]},
  {"title":"International Trade and Nigerian Economy","description":"ExamPilot navigation grouping for JAMB Economics topics.","topics":["Balance of trade","Balance of payments","Exchange rates","International trade","Economic integration","Nigerian economic sectors"]}
]$$::jsonb),
('Commerce', 'Commerce', 'UTME Commerce', 'Co', 'Understand trade, business organisation, finance, insurance, transport, banking and aids to trade.', 9, $$[
  {"title":"Commerce and Occupation","description":"ExamPilot navigation grouping for JAMB Commerce topics.","topics":["Meaning and scope of commerce","Occupation","Production and specialisation","Trade and exchange"]},
  {"title":"Trade","description":"ExamPilot navigation grouping for JAMB Commerce topics.","topics":["Home trade","Foreign trade","Wholesale trade","Retail trade","Channels of distribution"]},
  {"title":"Aids to Trade","description":"ExamPilot navigation grouping for JAMB Commerce topics.","topics":["Banking","Insurance","Transportation","Communication","Warehousing","Advertising"]},
  {"title":"Business Organisations","description":"ExamPilot navigation grouping for JAMB Commerce topics.","topics":["Sole proprietorship","Partnership","Companies","Co-operatives","Public enterprises"]},
  {"title":"Business Finance","description":"ExamPilot navigation grouping for JAMB Commerce topics.","topics":["Sources of finance","Capital market","Stock exchange","Financial institutions"]},
  {"title":"International Commerce","description":"ExamPilot navigation grouping for JAMB Commerce topics.","topics":["Balance of trade","Balance of payments","Exchange rates","Trade documents","International trade organisations"]},
  {"title":"Consumer and Business Protection","description":"ExamPilot navigation grouping for JAMB Commerce topics.","topics":["Consumer protection","Regulatory agencies","Business ethics","Trade associations"]}
]$$::jsonb),
('Accounting', 'Principles of Accounts', 'UTME Principles of Accounts', 'A', 'Build practical accounting skills from source documents through final accounts and analysis.', 10, $$[
  {"title":"Accounting Foundations","description":"ExamPilot navigation grouping for JAMB Principles of Accounts topics.","topics":["Meaning and objectives of accounting","Accounting concepts and conventions","Accounting equation","Double-entry principles"]},
  {"title":"Books and Records","description":"ExamPilot navigation grouping for JAMB Principles of Accounts topics.","topics":["Source documents","Books of original entry","Ledger accounts","Trial balance","Correction of errors"]},
  {"title":"Cash and Banking","description":"ExamPilot navigation grouping for JAMB Principles of Accounts topics.","topics":["Cash book","Petty cash book","Bank reconciliation statement","Banking transactions"]},
  {"title":"Final Accounts","description":"ExamPilot navigation grouping for JAMB Principles of Accounts topics.","topics":["Trading account","Profit and loss account","Statement of financial position","Adjustments"]},
  {"title":"Special Accounts","description":"ExamPilot navigation grouping for JAMB Principles of Accounts topics.","topics":["Manufacturing accounts","Partnership accounts","Company accounts","Non-profit organisations","Public sector accounts"]},
  {"title":"Analysis and Control","description":"ExamPilot navigation grouping for JAMB Principles of Accounts topics.","topics":["Control accounts","Incomplete records","Accounting ratios","Cost accounting","Budgeting"]}
]$$::jsonb),
('Geography', 'Geography', 'UTME Geography', 'GEO', 'Study map work, physical and human geography, Nigeria, Africa and world regional geography.', 11, $$[
  {"title":"Map Work","description":"ExamPilot navigation grouping for JAMB Geography topics.","topics":["Scale","Direction and bearings","Grid references","Relief representation","Map interpretation"]},
  {"title":"Physical Geography","description":"ExamPilot navigation grouping for JAMB Geography topics.","topics":["Earth structure","Rocks","Weathering","Erosion and deposition","Landforms"]},
  {"title":"Weather and Climate","description":"ExamPilot navigation grouping for JAMB Geography topics.","topics":["Atmosphere","Elements of weather","Climate types","Climatic factors","Climate change"]},
  {"title":"Soils and Vegetation","description":"ExamPilot navigation grouping for JAMB Geography topics.","topics":["Soil formation","Soil profiles","Vegetation zones","Natural resources","Conservation"]},
  {"title":"Human Geography","description":"ExamPilot navigation grouping for JAMB Geography topics.","topics":["Population","Migration","Settlement","Urbanisation","Economic activities"]},
  {"title":"Nigeria and Regional Geography","description":"ExamPilot navigation grouping for JAMB Geography topics.","topics":["Regions of Nigeria","Agriculture","Industry and mining","Transportation","West Africa","Africa and world regions"]}
]$$::jsonb),
('CRS', 'Christian Religious Studies', 'Christian Religious Studies', 'CRS', 'Study biblical events, teachings, Christian leadership, salvation, the early church and Christian living.', 12, $$[
  {"title":"Old Testament Foundations","description":"ExamPilot navigation grouping for JAMB Christian Religious Studies topics.","topics":["Creation and the fall","Call of Abraham","Covenant","Moses and the Exodus","The Ten Commandments"]},
  {"title":"Leadership and Prophets","description":"ExamPilot navigation grouping for JAMB Christian Religious Studies topics.","topics":["Joshua and Judges","Samuel and Saul","David and Solomon","Prophets and their messages","Justice and social responsibility"]},
  {"title":"Wisdom and Prophetic Literature","description":"ExamPilot navigation grouping for JAMB Christian Religious Studies topics.","topics":["Wisdom literature","Psalms and Proverbs","Major prophets","Minor prophets","Faith and obedience"]},
  {"title":"Life and Ministry of Jesus","description":"ExamPilot navigation grouping for JAMB Christian Religious Studies topics.","topics":["Birth and baptism","Temptation","Teachings and parables","Miracles","Discipleship"]},
  {"title":"Death and Resurrection","description":"ExamPilot navigation grouping for JAMB Christian Religious Studies topics.","topics":["Last Supper","Arrest and trial","Crucifixion","Resurrection","Ascension"]},
  {"title":"Early Church and Christian Living","description":"ExamPilot navigation grouping for JAMB Christian Religious Studies topics.","topics":["Pentecost","Early church fellowship","Pauline missions","Christian virtues","Love, service and forgiveness"]}
]$$::jsonb),
('History', 'History', 'UTME History', 'H', 'Study Nigerian, African and world history, historical change, nationalism and political development.', 13, $$[
  {"title":"Precolonial West Africa","description":"ExamPilot navigation grouping for JAMB History topics.","topics":["Early societies","Hausa states","Kanem-Borno","Yoruba states","Benin Kingdom","Igbo societies"]},
  {"title":"European Contact and Slave Trade","description":"ExamPilot navigation grouping for JAMB History topics.","topics":["European exploration","Trans-Atlantic slave trade","Missionary activities","Legitimate commerce"]},
  {"title":"Colonial Nigeria","description":"ExamPilot navigation grouping for JAMB History topics.","topics":["Colonial administration","Amalgamation","Indirect rule","Economic policies","Resistance movements"]},
  {"title":"Nationalism and Independence","description":"ExamPilot navigation grouping for JAMB History topics.","topics":["Nationalist movements","Constitutional development","Political parties","Independence"]},
  {"title":"Post-Independence Nigeria","description":"ExamPilot navigation grouping for JAMB History topics.","topics":["First Republic","Military rule","Civil War","Second Republic","Later political developments"]},
  {"title":"African and World History","description":"ExamPilot navigation grouping for JAMB History topics.","topics":["Pan-Africanism","African independence","Industrial Revolution","World wars","Cold War","Historical sources and methods"]}
]$$::jsonb);

DO $$
DECLARE
  seed_subject record;
  seed_section jsonb;
  seed_topic text;
  v_subject_id uuid;
  v_section_id uuid;
  stable_key text;
BEGIN
  FOR seed_subject IN SELECT * FROM _exam_pilot_syllabus_seed ORDER BY display_order LOOP
    INSERT INTO public.syllabus_subjects (name, display_name, subtitle, icon, overview, display_order)
    VALUES (seed_subject.name, seed_subject.display_name, seed_subject.subtitle, seed_subject.icon, seed_subject.overview, seed_subject.display_order)
    ON CONFLICT (name) DO NOTHING;

    SELECT id INTO v_subject_id
    FROM public.syllabus_subjects
    WHERE name = seed_subject.name;

    FOR seed_section IN SELECT value FROM jsonb_array_elements(seed_subject.sections) LOOP
      INSERT INTO public.syllabus_sections (subject_id, title, description, display_order)
      SELECT v_subject_id,
             seed_section->>'title',
             seed_section->>'description',
             row_number() OVER (ORDER BY ordinality)::integer
      FROM jsonb_array_elements(seed_subject.sections) WITH ORDINALITY
      WHERE value = seed_section
        AND NOT EXISTS (
          SELECT 1 FROM public.syllabus_sections existing
          WHERE existing.subject_id = v_subject_id AND existing.title = seed_section->>'title'
        );

      SELECT id INTO v_section_id
      FROM public.syllabus_sections
      WHERE syllabus_sections.subject_id = v_subject_id
        AND syllabus_sections.title = seed_section->>'title';

      FOR seed_topic IN SELECT jsonb_array_elements_text(seed_section->'topics') LOOP
        stable_key := 'jamb-syllabus-' || regexp_replace(lower(seed_subject.name || '-' || (seed_section->>'title') || '-' || seed_topic), '[^a-z0-9]+', '-', 'g');
        stable_key := regexp_replace(stable_key, '-+$', '');
        INSERT INTO public.syllabus_topics (section_id, title, description, content, display_order, import_key)
        VALUES (
          v_section_id,
          seed_topic,
          NULL,
          NULL,
          (SELECT coalesce(max(display_order), 0) + 1 FROM public.syllabus_topics WHERE syllabus_topics.section_id = v_section_id),
          stable_key
        )
        ON CONFLICT (import_key) DO NOTHING;
      END LOOP;
    END LOOP;
  END LOOP;
END
$$;

-- Safe post-run verification queries. These return diagnostics only.
SELECT name, display_name, display_order
FROM public.syllabus_subjects
ORDER BY display_order;

SELECT count(*) AS total_subjects FROM public.syllabus_subjects;
SELECT count(*) AS total_sections FROM public.syllabus_sections;
SELECT count(*) AS total_topics FROM public.syllabus_topics;
SELECT import_key, count(*) AS duplicate_count
FROM public.syllabus_topics
WHERE import_key IS NOT NULL
GROUP BY import_key
HAVING count(*) > 1;
SELECT sec.id
FROM public.syllabus_sections sec
LEFT JOIN public.syllabus_subjects subj ON subj.id = sec.subject_id
WHERE subj.id IS NULL;
SELECT topic.id
FROM public.syllabus_topics topic
LEFT JOIN public.syllabus_sections sec ON sec.id = topic.section_id
WHERE sec.id IS NULL;

-- English is intentionally not touched by this migration. Verify its anchor row:
SELECT subj.name, sec.title, topic.title, topic.import_key
FROM public.syllabus_subjects subj
JOIN public.syllabus_sections sec ON sec.subject_id = subj.id
JOIN public.syllabus_topics topic ON topic.section_id = sec.id
WHERE subj.name = 'English'
  AND sec.title = 'Comprehension & Summary'
  AND topic.title = 'Exposition and argumentation';
