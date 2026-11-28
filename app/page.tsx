import { createClient } from '@/utils/supabase/server'
import { cookies } from 'next/headers'

export default async function Page() {
  const cookieStore = await cookies()
  const supabase = createClient(cookieStore)

  const { data: todos } = await supabase.from('todos').select()

  return (
    <main className="min-h-screen p-8 bg-white dark:bg-black text-black dark:text-white">
      <h1 className="text-2xl font-bold mb-4">Supabase Connection Demo</h1>
      <ul className="list-disc pl-6 space-y-2">
        {todos?.map((todo) => (
          <li key={todo.id}>{todo.name}</li>
        ))}
      </ul>
      {(!todos || todos.length === 0) && (
        <p className="text-gray-500 mt-4">
          No todos found. If you just created the project, add a &quot;todos&quot; table with a &quot;name&quot; column in your Supabase dashboard.
        </p>
      )}
    </main>
  )
}
