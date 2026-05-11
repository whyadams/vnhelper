label ch2_bar:
    scene bar_counter with dissolve
    show tyler neutral at counter
    # Тайлер делает вид, что не замечает
    show hermione confident at left
    hermione "Если ты думаешь, что стакан опустеет от одного твоего взгляда..."
    hermione "Боюсь, тебя ждёт разочарование."
    show tyler surprised
    tyler thinking "(Ну вот... она здесь.)"
    tyler "Я... да нет, я не настолько наивен."
    "Стало неловко тихо."
    with fade
    pause 1.5
    menu:
        "Спросить, что она здесь делает":
            tyler "А ты что здесь делаешь?"
            jump ch2_bar_curious
        "Молча уйти" if score >= 0:
            jump ch2_bar_leave
    hide hermione with dissolve
    pause
    call cleanup_scene
    return

label ch2_bar_curious:
    "Тайлер впервые задаёт прямой вопрос."

label ch2_bar_leave:
    if mood < 0:
        tyler "Ну и ладно."
    else:
        tyler "Может, в другой раз."
    $ flag_left = True
    jump ch2_after

label ch2_after:
    "Конец сцены."
