import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import dotenv from 'dotenv';
import { getFruitImages } from './pixabayAPI.js';
import bcrypt from 'bcrypt';
import crypto from 'crypto';

dotenv.config();

const app = express();
const port = process.env.PORT

// Vercel's Supabase integration provides POSTGRES_URL. It is a pooled, SSL
// connection URL, which is the appropriate endpoint for Vercel functions.
const databaseUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL;

function withoutUrlSslOptions(connectionString) {
  const url = new URL(connectionString);
  // node-postgres lets these URL options replace the `ssl` object below.
  // Supabase/Vercel URLs commonly include `sslmode=require`.
  for (const option of ["ssl", "sslmode", "sslcert", "sslkey", "sslrootcert"]) {
    url.searchParams.delete(option);
  }
  return url.toString();
}

const db = new pg.Pool(
  databaseUrl
    ? {
        connectionString: withoutUrlSslOptions(databaseUrl),
        ssl: { rejectUnauthorized: false },
        // A serverless function can be scaled into many instances. Keep each
        // instance small and let Supabase's pooler manage the shared pool.
        max: 1,
      }
    : {
        // Keep local development compatible with the original .env format.
        user: process.env.DB_USER,
        host: process.env.DB_HOST,
        database: process.env.DB_NAME,
        password: process.env.DB_PASSWORD,
        port: process.env.DB_PORT,
        ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : undefined,
      }
);

// bcrypt config
const saltRounds = 10;
const SESSION_COOKIE = "fruit_quiz_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

function getSessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (process.env.VERCEL || process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET must be configured in production.");
  }
  return "development-only-session-secret";
}

function emptySession() {
  return { username: "", isAdmin: false, score: 0, question: null };
}

function parseCookies(request) {
  return Object.fromEntries((request.headers.cookie || "").split(";").filter(Boolean).map((cookie) => {
    const index = cookie.indexOf("=");
    return [cookie.slice(0, index).trim(), cookie.slice(index + 1)];
  }));
}

function signSession(payload) {
  return crypto.createHmac("sha256", getSessionSecret()).update(payload).digest("base64url");
}

function getSession(request) {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (!token) return emptySession();
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return emptySession();

  const received = Buffer.from(signature);
  const expected = Buffer.from(signSession(payload));
  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) return emptySession();

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!Number.isInteger(session.expiresAt) || session.expiresAt <= Date.now()) return emptySession();
    return {
      username: typeof session.username === "string" ? session.username : "",
      isAdmin: session.isAdmin === true,
      score: Number.isInteger(session.score) && session.score >= 0 ? session.score : 0,
      question: session.question && typeof session.question === "object" ? session.question : null,
      expiresAt: session.expiresAt
    };
  } catch {
    return emptySession();
  }
}

function setSession(response, session) {
  session.expiresAt = Date.now() + SESSION_MAX_AGE_SECONDS * 1000;
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  const token = `${payload}.${signSession(payload)}`;
  const attributes = ["HttpOnly", "Path=/", "SameSite=Lax", `Max-Age=${SESSION_MAX_AGE_SECONDS}`];
  if (process.env.VERCEL || process.env.NODE_ENV === "production") attributes.push("Secure");
  response.setHeader("Set-Cookie", `${SESSION_COOKIE}=${token}; ${attributes.join("; ")}`);
}

function clearSession(response) {
  response.setHeader("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}

async function loadQuiz() {
  const result = await db.query("SELECT * FROM fruits");
  return result.rows;
}


// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));
app.set("view engine", "ejs");
app.set("views", "./views");

async function nextQuestion() {
  const quiz = await loadQuiz();

  if (quiz.length === 0) {
    throw new Error("The fruits table is empty.");
  }

  const randomFruit = quiz[Math.floor(Math.random() * quiz.length)];

  return randomFruit;
}


// GET home page
app.get("/", async (req, res) => {
  const session = getSession(req);

  try {
    session.score = 0;
    session.question = await nextQuestion();
    setSession(res, session);
  } catch (error) {
    console.error("Unable to load quiz:", error);
    return res.status(503).send("The quiz database is unavailable. Check the Vercel database environment variables.");
  }

  res.render("index.ejs", { 
    question: session.question,
    user: session.username,
    permission : session.isAdmin
  });
});

// POST a new post
app.post("/submit", async(req, res) => {
  if (typeof req.body.answer !== "string") {
    return res.status(400).send("Answer is required.");
  }

  const session = getSession(req);
  if (!session.question) return res.redirect("/");

  const answer = req.body.answer.trim();
  let isCorrect = false;
  const current_fruit = session.question.fruit_name;
  const current_color = session.question.fruit_color;
  if (current_color.toLowerCase() == answer.toLowerCase()) {
    session.score++;
    isCorrect = true;
    session.question = await nextQuestion();
    setSession(res, session);
    res.render("index.ejs", {
      question: session.question,
      wasCorrect: isCorrect,
      totalScore: session.score,
      user : session.username,
      permission : session.isAdmin
    });
  }
  else{
    const finalScore = session.score;
    const finalQuestion = session.question;
    if (session.username != ""){
      await db.query("INSERT INTO scoreboard(username,score) VALUES ($1,$2);",[session.username, session.score]);
    }
    session.score = 0;
    session.question = null;
    setSession(res, session);
    try{
      const image = await getFruitImages(current_fruit, current_color);
      res.render("gameover.ejs",{
        question: finalQuestion,
        totalScore: finalScore,
        user: session.username,
        permission : session.isAdmin,
        image: image
      });
    }
    catch(err){
      res.render("gameover.ejs", {
        question: finalQuestion,
        totalScore: finalScore,
        user: session.username,
        permission: session.isAdmin,
        images: []
      });
    }
  }
});

// Login Page
app.get("/login",async(req,res)=>{
  res.render("login.ejs");
});

app.post("/login",async(req,res)=>{
  const username = req.body.username;
  const password = req.body.password;
  
  // Check admin login
  const checkadmin = await db.query("SELECT * FROM admins WHERE username = $1;", [username]);
  
  if (checkadmin.rowCount !== 0) {
    // Use bcrypt to compare password
    const match = await bcrypt.compare(password, checkadmin.rows[0].password);
    if (match) {
      const session = getSession(req);
      session.username = username;
      session.isAdmin = true;
      setSession(res, session);
      res.render("admin/admin_menu.ejs", {
        user: session.username
      });
    } else {
      res.render("login.ejs", {
        error : "Wrong username or password"
      });
    }
  } else {
    // Check user login
    const checkuser = await db.query("SELECT * FROM users WHERE username = $1;", [username]);
    
    if (checkuser.rowCount !== 0) {
      // Use bcrypt to compare password
      const match = await bcrypt.compare(password, checkuser.rows[0].password);
      if (match) {
        const session = getSession(req);
        session.username = username;
        session.isAdmin = false;
        setSession(res, session);
        res.redirect("/");
      } else {
        res.render("login.ejs", {
          error : "Wrong username or password"
        });
      }
    } else {
      res.render("login.ejs", {
        error : "Wrong username or password"
      });
    }
  }
});

// Logout
app.get("/logout",(req,res)=>{
  clearSession(res);
  res.redirect("/");
});

// Register Page 
app.get("/register",async(req,res)=>{
  res.render("register.ejs");
});

app.post("/register",async(req,res)=>{
  const username = req.body.username;
  const password = req.body.password;
  const confirm_password = req.body.confirm_password;
  const checkadmin = await db.query("SELECT * FROM admins WHERE LOWER(username) = LOWER($1)",[username]);
  if (checkadmin.rowCount == 0){
    if (password == confirm_password){
      try {
        // Hash password using bcrypt
        const hashedPassword = await bcrypt.hash(password, saltRounds);
        await db.query("INSERT INTO users(username,password) VALUES ($1,$2);", [username, hashedPassword]);
        res.redirect("/");
      }
      catch (err){
        res.render("register.ejs",{
          error : "Already have this username!!!"
        });
      }
    }
    else{
      res.render("register.ejs",{
        error : "Password does not match"
      });
    }
  }
  else{
    res.render("register.ejs",{
      error : "Already have this username!!!"
    });
  }
});

// Scoreboard Page
app.get("/scoreboard", async (req, res) => {
  const session = getSession(req);
  try {
    const result = await db.query("SELECT username,score FROM scoreboard ORDER BY score DESC , id ASC");
    const items = result.rows;
    res.render("scoreboard.ejs", {
      listItems: items,
      user: session.username,
      permission: session.isAdmin
    });
  } catch (err) {
    console.error("Unable to load scoreboard");
    res.status(503).send("The scoreboard is temporarily unavailable.");
  }
});


//check Permission
function checkPermission(req, res) {
  if (!getSession(req).isAdmin) {
    res.redirect("/");
    return false;
  }
  return true;
}

// Admin Page
app.get("/admin",(req,res)=>{
  if (!checkPermission(req, res)) return;
  res.render("admin/admin_menu.ejs",{
    user: getSession(req).username
  });
});

// Admin Add Page
app.get("/admin/add",(req,res)=>{
  if (!checkPermission(req, res)) return;
  res.render("admin/admin_add.ejs");
});

app.post("/admin/add",async(req,res)=>{
  if (!checkPermission(req, res)) return;
  const fruit_name = req.body.fruit_name.trim();
  const fruit_color = req.body.fruit_color.trim();
  const check_name = await db.query("SELECT * FROM fruits WHERE LOWER(fruit_name) = LOWER($1) ",[fruit_name]);
  const check_color = await db.query("SELECT * FROM fruits WHERE LOWER(fruit_color) = LOWER($1) ",[fruit_color]);

    if (check_color.rowCount !== 0){
      if (check_name.rowCount == 0){
        await db.query("INSERT INTO fruits(fruit_name,fruit_color) VALUES ($1,$2);",[fruit_name,fruit_color]);
        res.render("admin/admin_add.ejs",{
          message : "Add Fruit in Database Success!!!",
          pass : true
        });
      }
      else{
        res.render("admin/admin_add.ejs",{
          message : "Already have this Fruit Name in Database!!!"
        });
      }
    }
    else{
      res.render("admin/admin_add.ejs",{
        message : "This color does not exist!!!"
      });
    }
});

async function getItems() {
  const result = await db.query("SELECT * FROM fruits ORDER BY id ASC");
  return result.rows.map((data) => ({ name: data.fruit_name, color: data.fruit_color }));
}



// Admin Edit Page
app.get("/admin/edit",async(req,res)=>{
  if (!checkPermission(req, res)) return;
  const fruits = await getItems();
  res.render("admin/admin_edit.ejs",{
    fruits : fruits
  });
});

app.get("/admin/edit/:name",async(req,res)=>{
  if (!checkPermission(req, res)) return;
  const fruit_name = req.params.name.trim();
  const result = await db.query("SELECT * FROM fruits WHERE fruit_name = $1;",[fruit_name]);
  res.render("admin/admin_edit_detail.ejs",{
    fruit_name : result.rows[0].fruit_name,
    fruit_color : result.rows[0].fruit_color
  });
});


// Admin Confirm Edit Page
app.post("/admin/edit/:name/update", async (req, res) => {
  if (!checkPermission(req, res)) return;
  const oldName = req.params.name.trim();
  const newName = req.body.fruit_name.trim();
  const newColor = req.body.fruit_color;
  
  const checkColor = await db.query("SELECT * FROM fruits WHERE LOWER(fruit_color) = LOWER($1)", [newColor]);
  
  // Check Color doesn't has in database
  if (checkColor.rowCount === 0) {
    return res.render("admin/admin_edit_detail.ejs", {
      fruit_name: oldName,
      fruit_color: newColor,
      message: "This color does not exist!"
    });
  }
  
  // If fruit name changed, check if new name already exists
  if (oldName !== newName) {
    const checkName = await db.query("SELECT * FROM fruits WHERE LOWER(fruit_name) = LOWER($1)", [newName]);
    if (checkName.rowCount > 0) {
      return res.render("admin/admin_edit_detail.ejs", {
        fruit_name: oldName,
        fruit_color: newColor,
        message: "This fruit name already exists in the database!"
      });
    }
  }
  
  await db.query(
    "UPDATE fruits SET fruit_name = $1, fruit_color = $2 WHERE fruit_name = $3",
    [newName, newColor, oldName]
  );

  res.redirect("/admin/edit");

});




// Admin Remove Page
app.get("/admin/remove",async(req,res)=>{
  if (!checkPermission(req, res)) return;
  const fruits = await getItems();
  res.render("admin/admin_remove.ejs",{
    fruits : fruits
  });
});

app.post("/admin/remove/:name/confirm",async(req,res)=>{
  if (!checkPermission(req, res)) return;
  const fruit_name = req.params.name;
  await db.query("DELETE FROM fruits WHERE fruit_name = $1;",[fruit_name]);
  res.redirect("/admin/remove");
});

// Get Fruit image from picalbayAPI.js
app.get("/fruit-images/:fruit", async (req, res) => {
  const fruit = req.params.fruit;
  const color = req.query.color;
  try {
    const images = await getFruitImages(fruit, color);
    res.json(images);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching fruit images' });
  }
});



export default app;

if (!process.env.VERCEL) app.listen(port || 3000);
