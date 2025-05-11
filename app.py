from flask import Flask, render_template, request, redirect, url_for
import sqlite3

app = Flask(__name__)

# データベース接続
def get_db_connection():
    conn = sqlite3.connect('forum.db')
    conn.row_factory = sqlite3.Row  # 結果を辞書形式で取得
    return conn

# トップページ（部活一覧）
@app.route('/')
def index():
    conn = get_db_connection()
    clubs = conn.execute('SELECT * FROM clubs').fetchall()  # 部活の一覧を取得
    conn.close()
    return render_template('index.html', clubs=clubs)

# スレッド一覧ページ
@app.route('/club/<int:club_id>')
def club_threads(club_id):
    conn = get_db_connection()
    threads = conn.execute('SELECT * FROM threads WHERE club_id = ?', (club_id,)).fetchall()
    club_name = conn.execute('SELECT name FROM clubs WHERE id = ?', (club_id,)).fetchone()['name']
    conn.close()
    return render_template('threads.html', threads=threads, club_name=club_name, club_id=club_id)

# スレッドの詳細ページ
@app.route('/thread/<int:thread_id>')
def thread_details(thread_id):
    conn = get_db_connection()
    thread = conn.execute('SELECT * FROM threads WHERE id = ?', (thread_id,)).fetchone()
    comments = conn.execute('SELECT * FROM comments WHERE thread_id = ?', (thread_id,)).fetchall()
    conn.close()
    return render_template('thread_details.html', thread=thread, comments=comments)

# スレッドの投稿
@app.route('/post_thread/<int:club_id>', methods=('GET', 'POST'))
def post_thread(club_id):
    if request.method == 'POST':
        title = request.form['title']
        content = request.form['content']
        conn = get_db_connection()
        conn.execute('INSERT INTO threads (club_id, title, content) VALUES (?, ?, ?)', 
                     (club_id, title, content))
        conn.commit()
        conn.close()
        return redirect(url_for('club_threads', club_id=club_id))
    return render_template('post_thread.html', club_id=club_id)

# コメント投稿
@app.route('/post_comment/<int:thread_id>', methods=('POST',))
def post_comment(thread_id):
    comment = request.form['comment']
    user_name = request.form['user_name']
    conn = get_db_connection()
    conn.execute('INSERT INTO comments (thread_id, user_name, content) VALUES (?, ?, ?)', 
                 (thread_id, user_name, comment))
    conn.commit()
    conn.close()
    return redirect(url_for('thread_details', thread_id=thread_id))

if __name__ == '__main__':
    app.run(debug=True)
