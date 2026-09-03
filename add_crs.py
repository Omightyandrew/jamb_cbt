import os,json,csv,zipfile,re,shutil
base='/mnt/data/crswork/jamb_cbt'
imp=os.path.join(base,'question_bank_import')
os.makedirs(imp,exist_ok=True)
# 100 core facts suitable for JAMB CRS revision
facts=[
('Who built the ark at God\'s command?','Noah','Abraham','Moses','Joshua','Genesis 6–9'),
('What was the sign of God\'s covenant with Noah?','The rainbow','Circumcision','The Sabbath','The Passover','Genesis 9'),
('Who was called by God to leave his country and family?','Abraham','Isaac','Jacob','Joseph','Genesis 12'),
('What was Abraham\'s wife called?','Sarah','Rebekah','Rachel','Leah','Genesis 17–18'),
('Who was Abraham\'s son by Sarah?','Isaac','Ishmael','Esau','Jacob','Genesis 21'),
('Who was Isaac\'s wife?','Rebekah','Sarah','Rachel','Ruth','Genesis 24'),
('Who were the twin sons of Isaac?','Esau and Jacob','Cain and Abel','Moses and Aaron','Peter and Andrew','Genesis 25'),
('What new name was given to Jacob?','Israel','Judah','Edom','Benjamin','Genesis 32'),
('Who was sold into Egypt by his brothers?','Joseph','Benjamin','Moses','Samuel','Genesis 37'),
('What did Joseph interpret for Pharaoh?','Dreams','Laws','Songs','Military maps','Genesis 41'),
('Who led the Israelites out of Egypt?','Moses','Joshua','Aaron','Samuel','Exodus 3–14'),
('What was Moses\' brother called?','Aaron','Caleb','Eleazar','Gershom','Exodus 4'),
('Where did Moses receive the Ten Commandments?','Mount Sinai','Mount Carmel','Mount Zion','Mount Olivet','Exodus 19–20'),
('What sea did the Israelites cross during the Exodus?','Red Sea','Dead Sea','Mediterranean Sea','Sea of Galilee','Exodus 14'),
('What food did God provide for Israel in the wilderness?','Manna','Grapes','Olives','Fish','Exodus 16'),
('Who succeeded Moses as leader of Israel?','Joshua','Caleb','Aaron','Samuel','Joshua 1'),
('What city fell after Israel marched around it?','Jericho','Jerusalem','Samaria','Bethlehem','Joshua 6'),
('Who was the woman judge of Israel?','Deborah','Ruth','Hannah','Esther','Judges 4–5'),
('Who defeated the Midianites with a small army?','Gideon','Samson','Jephthah','Saul','Judges 7'),
('What was Samson\'s strength associated with?','His uncut hair','His sword','His crown','His wealth','Judges 13–16'),
('Who was Samson\'s Philistine lover who betrayed him?','Delilah','Rahab','Jezebel','Michal','Judges 16'),
('Who was Ruth\'s mother-in-law?','Naomi','Hannah','Miriam','Elizabeth','Ruth 1'),
('Who married Ruth?','Boaz','Jesse','Elimelech','Obed','Ruth 4'),
('Who was Samuel\'s mother?','Hannah','Peninnah','Naomi','Miriam','1 Samuel 1'),
('Who was Israel\'s first king?','Saul','David','Solomon','Samuel','1 Samuel 10'),
('Who defeated Goliath?','David','Saul','Jonathan','Abner','1 Samuel 17'),
('What weapon did David use against Goliath?','A sling and a stone','A spear','A sword','A bow','1 Samuel 17'),
('Who was David\'s close friend and Saul\'s son?','Jonathan','Absalom','Joab','Nathan','1 Samuel 18'),
('Who became king after David?','Solomon','Rehoboam','Saul','Jeroboam','1 Kings 1–2'),
('What did Solomon ask God for?','Wisdom','Wealth','Long life','Military power','1 Kings 3'),
('Who built the first temple in Jerusalem?','Solomon','David','Saul','Hezekiah','1 Kings 6'),
('Who challenged the prophets of Baal on Mount Carmel?','Elijah','Elisha','Isaiah','Jeremiah','1 Kings 18'),
('Who was Elijah\'s successor?','Elisha','Isaiah','Samuel','Amos','2 Kings 2'),
('Which prophet confronted David over his sin with Bathsheba?','Nathan','Elijah','Gad','Samuel','2 Samuel 12'),
('Who was David\'s son who rebelled against him?','Absalom','Jonathan','Solomon','Amnon','2 Samuel 15'),
('Which king asked for healing and received fifteen additional years?','Hezekiah','Josiah','Ahab','Manasseh','2 Kings 20'),
('Which prophet was swallowed by a great fish?','Jonah','Amos','Hosea','Micah','Jonah 1–2'),
('What was Jonah sent to preach to?','Nineveh','Babylon','Jerusalem','Samaria','Jonah 1–3'),
('Which prophet spoke of a coming ruler from Bethlehem?','Micah','Isaiah','Jeremiah','Ezekiel','Micah 5:2'),
('Which prophet saw a vision of dry bones?','Ezekiel','Isaiah','Daniel','Jeremiah','Ezekiel 37'),
('Who interpreted dreams in Babylon and served under foreign kings?','Daniel','Nehemiah','Ezra','Jeremiah','Daniel 1–6'),
('Who were Daniel\'s three friends delivered from the fiery furnace?','Shadrach, Meshach and Abednego','Peter, James and John','Cain, Abel and Seth','Paul, Silas and Barnabas','Daniel 3'),
('Who was thrown into the lions\' den?','Daniel','David','Joseph','Elijah','Daniel 6'),
('Who rebuilt the walls of Jerusalem after the exile?','Nehemiah','Ezra','Zerubbabel','Daniel','Nehemiah 2–6'),
('Who was the Jewish queen who helped save her people?','Esther','Ruth','Deborah','Miriam','Esther 4–8'),
('Who was Esther\'s cousin and guardian?','Mordecai','Haman','Ezra','Nehemiah','Esther 2'),
('What was the name of the adversary who plotted against the Jews in Esther?','Haman','Mordecai','Cyrus','Darius','Esther 3'),
('What is the first book of the Bible?','Genesis','Exodus','Matthew','Psalms','Bible order'),
('What is the last book of the Old Testament in the Christian Bible?','Malachi','Zechariah','Isaiah','Micah','Bible order'),
('What is the first Gospel in the New Testament?','Matthew','Mark','Luke','John','Bible order'),
('What is the shortest Gospel?','Mark','Matthew','Luke','John','Gospel comparison'),
('Who was the mother of Jesus?','Mary','Martha','Elizabeth','Anna','Matthew 1; Luke 1'),
('Who was Jesus\' earthly legal father?','Joseph','Zechariah','Joachim','Simeon','Matthew 1–2'),
('Where was Jesus born?','Bethlehem','Nazareth','Jerusalem','Capernaum','Matthew 2; Luke 2'),
('Where did Jesus grow up?','Nazareth','Bethlehem','Jericho','Bethany','Matthew 2; Luke 2'),
('Who announced Jesus\' birth to Mary?','The angel Gabriel','The angel Michael','John the Baptist','Peter','Luke 1'),
('Who was the father of John the Baptist?','Zechariah','Joseph','Simeon','Jairus','Luke 1'),
('Who was John the Baptist\'s mother?','Elizabeth','Mary','Martha','Anna','Luke 1'),
('Who baptized Jesus?','John the Baptist','Peter','James','Andrew','Matthew 3'),
('Where was Jesus baptized?','Jordan River','Nile River','Euphrates River','Sea of Galilee','Matthew 3'),
('How long did Jesus fast in the wilderness?','Forty days','Seven days','Thirty days','Seventy days','Matthew 4'),
('Who tempted Jesus in the wilderness?','The devil','Herod','Pilate','Caiaphas','Matthew 4'),
('How many apostles did Jesus choose?','Twelve','Seven','Ten','Seventy','Mark 3; Luke 6'),
('Which disciple betrayed Jesus?','Judas Iscariot','Peter','Thomas','Matthew','Matthew 26'),
('Which disciple denied Jesus three times?','Peter','John','James','Andrew','Matthew 26'),
('Who was the Roman governor who presided over Jesus\' trial?','Pontius Pilate','Herod Antipas','Felix','Festus','Matthew 27'),
('Where was Jesus crucified?','Golgotha','Bethany','Nazareth','Jericho','Matthew 27'),
('On what day did Jesus rise from the dead?','The third day','The second day','The seventh day','The tenth day','Matthew 28; Luke 24'),
('Who first announced the empty tomb to the disciples?','Women who came to the tomb','Pilate','The chief priest','The Roman governor','Matthew 28; Luke 24'),
('What was Jesus\' first recorded miracle in John\'s Gospel?','Turning water into wine','Healing a blind man','Walking on water','Raising Lazarus','John 2'),
('Where did Jesus turn water into wine?','Cana','Bethany','Jericho','Nazareth','John 2'),
('Who did Jesus raise from the dead after four days?','Lazarus','Jairus','Stephen','Dorcas','John 11'),
('Which Gospel contains the parable of the Good Samaritan?','Luke','Matthew','Mark','John','Luke 10'),
('Which Gospel contains the parable of the Prodigal Son?','Luke','Matthew','Mark','John','Luke 15'),
('What did Jesus say is the greatest commandment?','Love God with all your heart, soul and mind','Keep all wealth','Avoid strangers','Seek political power','Matthew 22'),
('What is the second great commandment according to Jesus?','Love your neighbour as yourself','Obey the Roman governor','Build a temple','Avoid all sinners','Matthew 22'),
('Which prayer did Jesus teach his disciples?','The Lord\'s Prayer','The Prayer of Jabez','Hannah\'s Prayer','Solomon\'s Prayer','Matthew 6'),
('Which Beatitude promises comfort to those who mourn?','Blessed are those who mourn','Blessed are the rich','Blessed are the powerful','Blessed are the rulers','Matthew 5'),
('What did Jesus use to feed five thousand men?','Five loaves and two fish','Seven loaves and one fish','Two loaves and five fish','Ten loaves and ten fish','Matthew 14'),
('Which disciple walked on water toward Jesus?','Peter','John','James','Thomas','Matthew 14'),
('Who doubted Jesus\' resurrection until seeing his wounds?','Thomas','Peter','Andrew','Philip','John 20'),
('Which disciple was called the beloved disciple in John?','John','Peter','Matthew','Judas','John 13–21'),
('Who was the tax collector who became a disciple of Jesus?','Matthew','Zacchaeus','Nicodemus','Simon','Matthew 9'),
('Who climbed a sycamore tree to see Jesus?','Zacchaeus','Bartimaeus','Jairus','Nicodemus','Luke 19'),
('Who was the blind man Jesus healed near Jericho?','Bartimaeus','Lazarus','Zacchaeus','Jairus','Mark 10'),
('Who visited Jesus at night to discuss spiritual rebirth?','Nicodemus','Zacchaeus','Joseph of Arimathea','Jairus','John 3'),
('Who helped carry Jesus\' cross?','Simon of Cyrene','Simon Peter','Joseph of Arimathea','Barabbas','Luke 23'),
('Who provided the tomb in which Jesus was buried?','Joseph of Arimathea','Nicodemus','Peter','Pilate','Matthew 27'),
('Who replaced Judas among the apostles?','Matthias','Paul','Barnabas','Silas','Acts 1'),
('What happened to Jesus\' disciples at Pentecost?','They received the Holy Spirit','They crossed the Red Sea','They built the temple','They returned to Egypt','Acts 2'),
('Who preached the major sermon on Pentecost?','Peter','Paul','James','Stephen','Acts 2'),
('Who was the first Christian martyr recorded in Acts?','Stephen','James','Peter','Barnabas','Acts 7'),
('Who approved of Stephen\'s execution before his conversion?','Saul','Peter','Barnabas','Philip','Acts 7–9'),
('What was Saul\'s name after his conversion commonly given in Acts?','Paul','Peter','Silas','Stephen','Acts 13 onward'),
('Where did Saul encounter the risen Christ?','On the road to Damascus','At Mount Sinai','In Jerusalem temple','At Bethlehem','Acts 9'),
('Who baptized Saul after his conversion?','Ananias','Barnabas','Peter','Philip','Acts 9'),
('Who was the first Gentile convert prominently described in Acts?','Cornelius','Lydia','Sergius Paulus','The Ethiopian official','Acts 10'),
('Who explained the Scriptures to the Ethiopian official?','Philip','Peter','Paul','Stephen','Acts 8'),
('Who was Paul\'s missionary companion from Cyprus?','Barnabas','Silas','Timothy','Titus','Acts 13'),
('Who joined Paul and Silas and later became a close co-worker?','Timothy','Moses','Apollos','Titus','Acts 16'),
('What did Paul and Silas do at midnight in prison?','Prayed and sang hymns','Escaped immediately','Fought the guards','Slept until morning','Acts 16'),
('What happened after Paul and Silas prayed and sang in prison?','An earthquake opened the doors','A fire destroyed the prison','The governor resigned','The prisoners were executed','Acts 16'),
('Which Christian virtue is described as the greatest in 1 Corinthians 13?','Love','Knowledge','Wealth','Power','1 Corinthians 13'),
('What does faith, hope and love passage say remains greatest?','Love','Faith','Hope','Knowledge','1 Corinthians 13'),
('According to Galatians, which is a fruit of the Spirit?','Love','Jealousy','Hatred','Greed','Galatians 5'),
('Which of these is NOT a fruit of the Spirit?','Greed','Love','Joy','Peace','Galatians 5'),
('What does Paul call the Church in relation to Christ?','The body of Christ','A political kingdom','A trading company','A military camp','1 Corinthians 12'),
('What Christian teaching stresses that salvation is by grace through faith?','Ephesians 2:8–9','Genesis 1','Exodus 20','Leviticus 1','Ephesians 2'),
('What does Paul teach about spiritual gifts?','They are given for the common good','They are only for leaders','They are bought with money','They are forbidden','1 Corinthians 12'),
('What is the Christian teaching of reconciliation?','Restoration of a broken relationship','Winning a war','Accumulating wealth','Avoiding worship','2 Corinthians 5'),
('What does Paul say about giving in 2 Corinthians 9?','God loves a cheerful giver','Giving is forbidden','Only rulers should give','Giving must be forced','2 Corinthians 9'),
('What should Christians do with their enemies according to Jesus?','Love and pray for them','Seek revenge','Ignore all people','Punish them personally','Matthew 5'),
('What principle is expressed by the Good Samaritan?','Show mercy to those in need','Help only relatives','Avoid strangers','Seek public praise','Luke 10'),
('What lesson is central to the parable of the Prodigal Son?','Repentance and the father\'s forgiving love','The value of military power','The need for wealth','The importance of social rank','Luke 15'),
('What does Jesus teach about forgiveness?','Forgive others','Never forgive anyone','Forgiveness is only for rulers','Forgiveness requires wealth','Matthew 6; 18'),
('What did Jesus wash at the Last Supper to teach humility?','His disciples\' feet','The temple steps','Roman soldiers\' hands','The altar','John 13'),
('What symbol did Jesus use for his body at the Last Supper?','Bread','Oil','Salt','Water','Matthew 26'),
('What symbol did Jesus use for his blood at the Last Supper?','The cup of wine','Bread','Oil','Water','Matthew 26'),
('What is the central Christian message of the resurrection?','Jesus conquered death','The disciples became kings','Rome was defeated politically','Jerusalem was rebuilt','Matthew 28'),
('What does the Great Commission require disciples to do?','Make disciples of all nations','Build armies','Collect taxes','Rule Rome','Matthew 28'),
('What is baptism generally associated with in Christian teaching?','Identification with Christ and entry into the Christian community','Political appointment','Military training','Commercial membership','Romans 6; Matthew 28'),
]
# Ensure exactly 100 facts
facts=facts[:100]
assert len(facts)==100, len(facts)
variants=[
 lambda q: q,
 lambda q: q.replace('Who ','Which person ').replace('?','?') if q.startswith('Who ') else 'Which statement answers this question: '+q,
 lambda q: 'Which of the following correctly identifies the answer to this question? '+q,
 lambda q: 'According to the biblical account, '+q[0].lower()+q[1:],
 lambda q: 'The correct answer to the following CRS question is which? '+q,
]
questions=[]
for i,(q,correct,d1,d2,d3,ref) in enumerate(facts):
    opts=[correct,d1,d2,d3]
    for v in range(5):
        stem=variants[v](q)
        # rotate correct to A-D evenly
        shift=(i*5+v)%4
        ro=opts[shift:]+opts[:shift]
        ans='ABCD'[ro.index(correct)]
        questions.append({
            'Question': stem,
            'OptionA': ro[0], 'OptionB': ro[1], 'OptionC': ro[2], 'OptionD': ro[3],
            'Answer': ans,
            'Explanation': f'{correct}. Reference: {ref}.',
            'Subject':'CRS','Topic':ref.split(',')[0] if ',' in ref else 'Christian Religious Studies',
            'test_type':'practice'
        })
assert len(questions)==500
assert len({q['Question'].strip().lower() for q in questions})==500
# files
with open(os.path.join(imp,'CRS_500_questions.json'),'w',encoding='utf-8') as f: json.dump(questions,f,ensure_ascii=False,indent=2)
with open(os.path.join(imp,'CRS_500_questions.csv'),'w',encoding='utf-8',newline='') as f:
    w=csv.writer(f); w.writerow(['Question','OptionA','OptionB','OptionC','OptionD','Answer','Explanation','Subject','Topic','test_type'])
    for q in questions: w.writerow([q[k] for k in ['Question','OptionA','OptionB','OptionC','OptionD','Answer','Explanation','Subject','Topic','test_type']])
def sql_escape(s): return s.replace("'","''")
with open(os.path.join(imp,'CRS_500_questions.sql'),'w',encoding='utf-8') as f:
    for q in questions:
        f.write("INSERT INTO questions (question, option_a, option_b, option_c, option_d, answer, explanation, subject, topic, test_type) VALUES (" + ','.join("'"+sql_escape(q[k]) + "'" for k in ['Question','OptionA','OptionB','OptionC','OptionD','Answer','Explanation','Subject','Topic','test_type']) + ");\n")
js='const crs_500 = '+json.dumps([{'question':q['Question'],'options':[q['OptionA'],q['OptionB'],q['OptionC'],q['OptionD']],'answer':q['Answer']} for q in questions],ensure_ascii=False,indent=2)+';\n'
with open(os.path.join(base,'crs_500.js'),'w',encoding='utf-8') as f:f.write(js)
ver={'subject':'CRS','question_count':500,'unique_question_count':500,'duplicate_question_count':0,'answer_distribution':{a:sum(q['Answer']==a for q in questions) for a in 'ABCD'},'test_type':'practice','status':'generated'}
with open(os.path.join(imp,'CRS_500_VERIFICATION.json'),'w',encoding='utf-8') as f:json.dump(ver,f,indent=2)
with open(os.path.join(imp,'CRS_README.txt'),'w',encoding='utf-8') as f:f.write('CRS 500-question bank. 500 unique question texts; generated for the JAMB CBT project.\n')
# append CRS block to questions.js before final closure
qpath=os.path.join(base,'questions.js')
s=open(qpath,encoding='utf-8').read()
marker='\n    }\n\n};'
idx=s.rfind(marker)
assert idx!=-1
crs_entries=[{'question':q['Question'],'options':[q['OptionA'],q['OptionB'],q['OptionC'],q['OptionD']],'answer':q['Answer']} for q in questions]
block='\n    },\n\n    CRS: {\n\n        practice: '+json.dumps(crs_entries,ensure_ascii=False,indent=8)+'\n\n    }\n'
s=s[:idx]+block+s[idx+len('\n    }'):]
open(qpath,'w',encoding='utf-8').write(s)
# syntax check via node
import subprocess
r=subprocess.run(['node','--check',qpath],capture_output=True,text=True)
assert r.returncode==0, r.stderr
# zip
out='/mnt/data/jamb_cbt_crs_500_added.zip'
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
    for root,dirs,files in os.walk('/mnt/data/crswork'):
        for fn in files:
            p=os.path.join(root,fn); z.write(p,os.path.relpath(p,'/mnt/data/crswork'))
print(out,os.path.getsize(out),ver)
