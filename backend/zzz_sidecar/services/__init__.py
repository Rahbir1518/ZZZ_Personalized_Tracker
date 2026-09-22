"""Service layer.

Intentionally empty of re-exports: importing a service should not pull in the
others' heavy dependencies. ``analysis`` is pure and must stay importable (and
testable) without ``genshin`` or ``hakushin`` installed.
"""
