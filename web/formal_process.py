from queue import Empty
from subprocess import PIPE, STDOUT
from _formal_host import spawn_solver


class SolverInput:
    def __init__(self, handle):
        self.handle = handle
        self.closed = False

    def write(self, data):
        if self.closed:
            raise ValueError("Write to closed virtual solver stdin")
        return self.handle.stdin_write(data)

    def flush(self):
        if self.closed:
            raise ValueError("Flush of closed virtual solver stdin")

    def close(self):
        if not self.closed:
            self.handle.stdin_close()
            self.closed = True


class Popen:
    def __init__(self, args, *, stdin, stdout, stderr):
        if stdin != PIPE or stdout != PIPE or stderr != STDOUT:
            raise ValueError("Unsupported virtual solver stdio configuration")
        self.handle = spawn_solver(args)
        self.stdin = SolverInput(self.handle)

    def terminate(self):
        self.handle.terminate()

    def wait(self):
        return self.handle.finish()

    def poll(self):
        return self.handle.poll()


class SolverQueue:
    def __init__(self, owner):
        self.owner = owner

    def get(self, block=True, timeout=None):
        value = self.owner.p.handle.readline(-1 if block and timeout is None else timeout if block else 0)
        if value is None:
            raise Empty
        raw = bytes(value.to_py())
        if not raw:
            self.owner.p_running = False
        return raw.decode("utf-8")

    def join(self):
        self.owner.p.handle.finish()
        self.owner.p_running = False
